import { BALANCE } from '../../config/balance.js';
import { SeededRng } from '../../math/rng.js';
import { clampPositionToArena } from '../../math/vec2.js';
import type {
  ExplorationModeStateSnapshot,
  ExplorationSubPhase,
  HordeClearedEvent,
  HordeStartedEvent,
  HordeWarningEvent,
  PlayerStateSnapshot,
  ZombieKind,
  ZombieStateSnapshot,
} from '../../types/protocol.js';

export interface QueuedHordeZombie {
  kind: ZombieKind;
  isElite: boolean;
}

export interface ExplorationDirectorCallbacks {
  spawnZombieFromDirector: (
    kind: ZombieKind,
    options: {
      isElite: boolean;
      spawnSource: 'ambient' | 'horde';
      position?: { x: number; y: number };
    }
  ) => ZombieStateSnapshot | null;
  emitHordeWarning: (ev: Omit<HordeWarningEvent, 'eventId' | 'tick'>) => void;
  emitHordeStarted: (ev: Omit<HordeStartedEvent, 'eventId' | 'tick'>) => void;
  emitHordeCleared: (ev: Omit<HordeClearedEvent, 'eventId' | 'tick'>) => void;
}

export interface ExplorationTimingOverrides {
  firstHordeDelayMs?: number;
  hordeWarningMs?: number;
  subsequentHordeIntervalMs?: number;
  recoveryWindowMs?: number;
}

/**
 * Calcula o orçamento de ameaça de uma horda periódica no Modo 2 (Exploração e Abrigo).
 */
export function computeHordeThreatBudget(
  hordeNumber: number,
  activePlayerCount: number
): number {
  const safeHorde = Math.max(1, Math.floor(hordeNumber));
  const base =
    BALANCE.EXPLORATION.BASE_HORDE_THREAT_BUDGET +
    (safeHorde - 1) * BALANCE.EXPLORATION.HORDE_THREAT_GROWTH;
  const coopFactor =
    activePlayerCount >= 2 ? BALANCE.ROUNDS.COOP_THREAT_MULTIPLIER : 1;
  return Math.max(12, Math.round(base * coopFactor));
}

/**
 * Controlador dedicado ao Modo 2 — Exploração e Abrigo (Etapa 1).
 * - População inicial de zumbis comuns espalhados pelo mapa + pequenos encontros de exploração.
 * - Horda maior periódica com preparação e aviso antecipado:
 *   - Primeira horda após 8 minutos (`FIRST_HORDE_DELAY_MS = 480.000 ms`), com aviso de 60s (`HORDE_WARNING_MS = 60.000 ms`).
 *   - Próximas hordas aproximadamente a cada 6 minutos (`SUBSEQUENT_HORDE_INTERVAL_MS = 360.000 ms`).
 *   - Cada horda é finita e possui condição clara de conclusão.
 *   - Após vencer a horda, há uma janela de recuperação (`RECOVERY_WINDOW_MS = 45.000 ms`).
 * - Registra dias sobrevividos, hordas vencidas e setores explorados.
 */
export class ExplorationDirector {
  private rng: SeededRng;
  private readonly mapWidth: number;
  private readonly mapHeight: number;

  private firstHordeDelayMs: number;
  private hordeWarningMs: number;
  private subsequentHordeIntervalMs: number;
  private recoveryWindowMs: number;

  private explorationPhase: ExplorationSubPhase = 'exploring';
  private hordeNumber = 0;
  private hordesCleared = 0;
  private timeUntilNextHordeMs: number;
  private recoveryRemainingMs = 0;
  private encounterTimerMs = 0;
  private hordeSpawnTimerMs = 0;

  private hordeTotalZombies = 0;
  private hordeSpawnedZombies = 0;
  private readonly pendingHordeQueue: QueuedHordeZombie[] = [];
  private readonly exploredSectorKeys = new Set<string>();
  private ambientSeeded = false;

  constructor(
    seed: number,
    mapWidth: number = BALANCE.MAP.WIDTH,
    mapHeight: number = BALANCE.MAP.HEIGHT,
    timingOverrides?: ExplorationTimingOverrides
  ) {
    this.rng = new SeededRng((seed ^ 0xbb67ae85) >>> 0);
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.firstHordeDelayMs =
      timingOverrides?.firstHordeDelayMs ??
      BALANCE.EXPLORATION.FIRST_HORDE_DELAY_MS;
    this.hordeWarningMs =
      timingOverrides?.hordeWarningMs ?? BALANCE.EXPLORATION.HORDE_WARNING_MS;
    this.subsequentHordeIntervalMs =
      timingOverrides?.subsequentHordeIntervalMs ??
      BALANCE.EXPLORATION.SUBSEQUENT_HORDE_INTERVAL_MS;
    this.recoveryWindowMs =
      timingOverrides?.recoveryWindowMs ??
      BALANCE.EXPLORATION.RECOVERY_WINDOW_MS;
    this.timeUntilNextHordeMs = this.firstHordeDelayMs;
  }

  reset(seed: number, timingOverrides?: ExplorationTimingOverrides): void {
    this.rng = new SeededRng((seed ^ 0xbb67ae85) >>> 0);
    if (timingOverrides?.firstHordeDelayMs !== undefined) {
      this.firstHordeDelayMs = timingOverrides.firstHordeDelayMs;
    }
    if (timingOverrides?.hordeWarningMs !== undefined) {
      this.hordeWarningMs = timingOverrides.hordeWarningMs;
    }
    if (timingOverrides?.subsequentHordeIntervalMs !== undefined) {
      this.subsequentHordeIntervalMs = timingOverrides.subsequentHordeIntervalMs;
    }
    if (timingOverrides?.recoveryWindowMs !== undefined) {
      this.recoveryWindowMs = timingOverrides.recoveryWindowMs;
    }

    this.explorationPhase = 'exploring';
    this.hordeNumber = 0;
    this.hordesCleared = 0;
    this.timeUntilNextHordeMs = this.firstHordeDelayMs;
    this.recoveryRemainingMs = 0;
    this.encounterTimerMs = 0;
    this.hordeSpawnTimerMs = 0;
    this.hordeTotalZombies = 0;
    this.hordeSpawnedZombies = 0;
    this.pendingHordeQueue.length = 0;
    this.exploredSectorKeys.clear();
    this.ambientSeeded = false;
  }

  step(
    dtMs: number,
    players: readonly PlayerStateSnapshot[],
    zombies: readonly ZombieStateSnapshot[],
    callbacks: ExplorationDirectorCallbacks
  ): void {
    const livingPlayers = players.filter((p) => p.alive);
    if (livingPlayers.length === 0) {
      return;
    }

    // 1. Registra setores de exploração visitados pelos jogadores vivos
    for (const p of livingPlayers) {
      const sx = Math.floor(p.x / BALANCE.EXPLORATION.SECTOR_SIZE_PX);
      const sy = Math.floor(p.y / BALANCE.EXPLORATION.SECTOR_SIZE_PX);
      this.exploredSectorKeys.add(`${sx}:${sy}`);
    }

    // 2. Popula zumbis comuns iniciais espalhados pelo mapa na abertura da partida
    if (!this.ambientSeeded) {
      this.ambientSeeded = true;
      this.seedInitialAmbientZombies(livingPlayers, zombies, callbacks);
    }

    // 3. Máquina de estados da Exploração e Hordas Periódicas
    if (this.explorationPhase === 'recovery') {
      this.recoveryRemainingMs = Math.max(0, this.recoveryRemainingMs - dtMs);
      if (this.recoveryRemainingMs <= 0) {
        this.explorationPhase = 'exploring';
        this.timeUntilNextHordeMs = this.subsequentHordeIntervalMs;
      }
      return;
    }

    if (
      this.explorationPhase === 'exploring' ||
      this.explorationPhase === 'horde_warning'
    ) {
      this.timeUntilNextHordeMs = Math.max(0, this.timeUntilNextHordeMs - dtMs);

      // Pequenos encontros durante a exploração enquanto abaixo do limite de população ambiente
      this.encounterTimerMs += dtMs;
      if (this.encounterTimerMs >= BALANCE.EXPLORATION.ENCOUNTER_INTERVAL_MS) {
        this.encounterTimerMs -= BALANCE.EXPLORATION.ENCOUNTER_INTERVAL_MS;
        this.spawnSmallEncounterGroup(livingPlayers, zombies, callbacks);
      }

      // Dispara o aviso antecipado de 60 segundos antes da horda chegar
      if (
        this.explorationPhase === 'exploring' &&
        this.timeUntilNextHordeMs <= this.hordeWarningMs &&
        this.timeUntilNextHordeMs > 0
      ) {
        this.explorationPhase = 'horde_warning';
        callbacks.emitHordeWarning({
          type: 'horde_warning',
          hordeNumber: this.hordeNumber + 1,
          warningMs: this.timeUntilNextHordeMs,
        });
      }

      // Quando o cronômetro zera, inicia a horda periódica finita
      if (this.timeUntilNextHordeMs <= 0) {
        this.startPeriodicHorde(livingPlayers.length, callbacks);
      }
      return;
    }

    // 4. Fase 'horde_active': libera a fila finita da horda e verifica conclusão
    this.hordeSpawnTimerMs += dtMs;
    const spawnIntervalMs = BALANCE.EXPLORATION.HORDE_SPAWN_INTERVAL_MS;
    while (
      this.pendingHordeQueue.length > 0 &&
      this.hordeSpawnTimerMs >= spawnIntervalMs &&
      zombies.length < BALANCE.SPAWN.MAX_ALIVE
    ) {
      this.hordeSpawnTimerMs -= spawnIntervalMs;
      const next = this.pendingHordeQueue[0];
      const spawned = callbacks.spawnZombieFromDirector(next.kind, {
        isElite: next.isElite,
        spawnSource: 'horde',
      });
      if (spawned) {
        this.pendingHordeQueue.shift();
        this.hordeSpawnedZombies += 1;
      } else {
        break;
      }
    }

    if (zombies.length >= BALANCE.SPAWN.MAX_ALIVE) {
      this.hordeSpawnTimerMs = Math.min(this.hordeSpawnTimerMs, spawnIntervalMs);
    }

    // Condição clara de conclusão da horda: fila vazia e nenhum inimigo da horda vivo
    const activeHordeZombies = zombies.filter(
      (z) => z.hp > 0 && z.spawnSource === 'horde'
    ).length;

    if (this.pendingHordeQueue.length === 0 && activeHordeZombies === 0) {
      this.hordesCleared += 1;
      this.explorationPhase = 'recovery';
      this.recoveryRemainingMs = this.recoveryWindowMs;

      callbacks.emitHordeCleared({
        type: 'horde_cleared',
        hordeNumber: this.hordeNumber,
        recoveryMs: this.recoveryRemainingMs,
      });
    }
  }

  getStateSnapshot(
    elapsedMs: number,
    zombies: readonly ZombieStateSnapshot[]
  ): ExplorationModeStateSnapshot {
    const dayDuration = BALANCE.EXPLORATION.DAY_DURATION_MS;
    const daysSurvived = Math.floor(Math.max(0, elapsedMs) / dayDuration);
    const dayProgressRatio = Number(
      ((Math.max(0, elapsedMs) % dayDuration) / dayDuration).toFixed(3)
    );

    const activeHordeAlive = zombies.filter(
      (z) => z.hp > 0 && z.spawnSource === 'horde'
    ).length;
    const ambientAlive = zombies.filter(
      (z) => z.hp > 0 && z.spawnSource !== 'horde'
    ).length;

    const totalSectors =
      Math.ceil(this.mapWidth / BALANCE.EXPLORATION.SECTOR_SIZE_PX) *
      Math.ceil(this.mapHeight / BALANCE.EXPLORATION.SECTOR_SIZE_PX);

    return {
      explorationPhase: this.explorationPhase,
      daysSurvived,
      dayProgressRatio,
      hordeNumber: this.hordeNumber,
      hordesCleared: this.hordesCleared,
      timeUntilNextHordeMs:
        this.explorationPhase === 'exploring' ||
        this.explorationPhase === 'horde_warning'
          ? this.timeUntilNextHordeMs
          : 0,
      warningRemainingMs:
        this.explorationPhase === 'horde_warning'
          ? this.timeUntilNextHordeMs
          : 0,
      recoveryRemainingMs:
        this.explorationPhase === 'recovery' ? this.recoveryRemainingMs : 0,
      hordeTotalZombies: this.hordeTotalZombies,
      hordeSpawnedZombies: this.hordeSpawnedZombies,
      hordeRemainingZombies:
        this.explorationPhase === 'horde_active'
          ? this.pendingHordeQueue.length + activeHordeAlive
          : 0,
      ambientZombiesAlive: ambientAlive,
      sectorsExplored: this.exploredSectorKeys.size,
      totalSectors,
    };
  }

  private seedInitialAmbientZombies(
    livingPlayers: readonly PlayerStateSnapshot[],
    zombies: readonly ZombieStateSnapshot[],
    callbacks: ExplorationDirectorCallbacks
  ): void {
    const minSafeDist = BALANCE.SPAWN.RING_MIN_RADIUS;
    const minSafeDistSq = minSafeDist * minSafeDist;
    const count = BALANCE.EXPLORATION.INITIAL_AMBIENT_COUNT;

    for (let i = 0; i < count; i += 1) {
      if (zombies.length >= BALANCE.SPAWN.MAX_ALIVE) {
        break;
      }

      let pos = { x: 400, y: 400 };
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidateX = this.rng.nextRange(120, this.mapWidth - 120);
        const candidateY = this.rng.nextRange(120, this.mapHeight - 120);
        const clamped = clampPositionToArena(
          candidateX,
          candidateY,
          BALANCE.ZOMBIES.COMMON.RADIUS,
          this.mapWidth,
          this.mapHeight
        );

        const farEnough = livingPlayers.every((p) => {
          const dx = clamped.x - p.x;
          const dy = clamped.y - p.y;
          return dx * dx + dy * dy >= minSafeDistSq;
        });
        if (farEnough) {
          pos = clamped;
          break;
        }
      }

      callbacks.spawnZombieFromDirector('common', {
        isElite: false,
        spawnSource: 'ambient',
        position: pos,
      });
    }
  }

  private spawnSmallEncounterGroup(
    livingPlayers: readonly PlayerStateSnapshot[],
    zombies: readonly ZombieStateSnapshot[],
    callbacks: ExplorationDirectorCallbacks
  ): void {
    const ambientAlive = zombies.filter(
      (z) => z.hp > 0 && z.spawnSource !== 'horde'
    ).length;
    if (
      ambientAlive >= BALANCE.EXPLORATION.MAX_AMBIENT_ALIVE ||
      zombies.length >= BALANCE.SPAWN.MAX_ALIVE
    ) {
      return;
    }

    const groupSize = this.rng.nextInt(
      BALANCE.EXPLORATION.ENCOUNTER_GROUP_MIN,
      BALANCE.EXPLORATION.ENCOUNTER_GROUP_MAX
    );

    const anchor = livingPlayers[this.rng.nextInt(0, livingPlayers.length - 1)];
    const baseAngle = this.rng.nextRange(0, Math.PI * 2);
    const baseDist = this.rng.nextRange(
      BALANCE.SPAWN.RING_MIN_RADIUS,
      BALANCE.SPAWN.RING_MAX_RADIUS
    );

    for (let i = 0; i < groupSize; i += 1) {
      if (zombies.length >= BALANCE.SPAWN.MAX_ALIVE) {
        break;
      }
      const jitterAngle = baseAngle + this.rng.nextRange(-0.18, 0.18);
      const jitterDist = baseDist + this.rng.nextRange(-35, 35);
      const pos = clampPositionToArena(
        anchor.x + Math.cos(jitterAngle) * jitterDist,
        anchor.y + Math.sin(jitterAngle) * jitterDist,
        BALANCE.ZOMBIES.COMMON.RADIUS,
        this.mapWidth,
        this.mapHeight
      );
      const kind: ZombieKind = this.rng.nextFloat() < 0.25 ? 'fast' : 'common';
      callbacks.spawnZombieFromDirector(kind, {
        isElite: false,
        spawnSource: 'ambient',
        position: pos,
      });
    }
  }

  private startPeriodicHorde(
    activePlayersCount: number,
    callbacks: ExplorationDirectorCallbacks
  ): void {
    this.hordeNumber += 1;
    this.explorationPhase = 'horde_active';
    this.timeUntilNextHordeMs = 0;

    const budget = computeHordeThreatBudget(
      this.hordeNumber,
      activePlayersCount
    );
    this.buildHordeQueue(this.hordeNumber, budget);
    this.hordeTotalZombies = this.pendingHordeQueue.length;
    this.hordeSpawnedZombies = 0;
    this.hordeSpawnTimerMs = BALANCE.EXPLORATION.HORDE_SPAWN_INTERVAL_MS;

    callbacks.emitHordeStarted({
      type: 'horde_started',
      hordeNumber: this.hordeNumber,
      totalZombies: this.hordeTotalZombies,
    });
  }

  private buildHordeQueue(hordeNumber: number, budget: number): void {
    this.pendingHordeQueue.length = 0;
    let remaining = budget;

    // A partir da 2ª horda (ou em toda horda par), inclui um líder de Elite
    if (hordeNumber >= 2) {
      this.pendingHordeQueue.push({ kind: 'brute', isElite: true });
      remaining = Math.max(6, remaining - BALANCE.ROUNDS.THREAT_COST.ELITE);
    }

    while (remaining > 0) {
      const roll = this.rng.nextFloat();
      if (
        remaining >= BALANCE.ROUNDS.THREAT_COST.BRUTE &&
        roll < Math.min(0.28, 0.12 + hordeNumber * 0.04)
      ) {
        this.pendingHordeQueue.push({ kind: 'brute', isElite: false });
        remaining -= BALANCE.ROUNDS.THREAT_COST.BRUTE;
      } else if (
        remaining >= BALANCE.ROUNDS.THREAT_COST.FAST &&
        roll < Math.min(0.62, 0.3 + hordeNumber * 0.05)
      ) {
        this.pendingHordeQueue.push({ kind: 'fast', isElite: false });
        remaining -= BALANCE.ROUNDS.THREAT_COST.FAST;
      } else {
        this.pendingHordeQueue.push({ kind: 'common', isElite: false });
        remaining -= BALANCE.ROUNDS.THREAT_COST.COMMON;
      }
    }
  }
}
