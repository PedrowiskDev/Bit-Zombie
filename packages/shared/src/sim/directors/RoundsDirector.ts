import { BALANCE } from '../../config/balance.js';
import { SeededRng } from '../../math/rng.js';
import type {
  PlayerStateSnapshot,
  RoundCompletedEvent,
  RoundStartedEvent,
  RoundSubPhase,
  RoundsModeStateSnapshot,
  ZombieKind,
  ZombieStateSnapshot,
} from '../../types/protocol.js';

export interface QueuedRoundZombie {
  kind: ZombieKind;
  isElite: boolean;
  speedMultiplier?: number;
}

export interface RoundsDirectorCallbacks {
  spawnZombieFromDirector: (
    kind: ZombieKind,
    options: {
      isElite: boolean;
      spawnSource: 'round';
      speedMultiplier?: number;
    }
  ) => ZombieStateSnapshot | null;
  emitRoundStarted: (ev: Omit<RoundStartedEvent, 'eventId' | 'tick'>) => void;
  emitRoundCompleted: (ev: Omit<RoundCompletedEvent, 'eventId' | 'tick'>) => void;
}

/**
 * Calcula o orçamento de ameaça para uma rodada numerada no Modo 1 (Sobrevivência por Rodadas).
 */
export function computeRoundThreatBudget(
  roundNumber: number,
  activePlayerCount: number
): number {
  const safeRound = Math.max(1, Math.floor(roundNumber));
  const base =
    BALANCE.ROUNDS.BASE_THREAT_BUDGET +
    (safeRound - 1) * BALANCE.ROUNDS.THREAT_BUDGET_PER_ROUND;
  const coopFactor =
    activePlayerCount >= 2 ? BALANCE.ROUNDS.COOP_THREAT_MULTIPLIER : 1;
  return Math.max(6, Math.round(base * coopFactor));
}

/**
 * Controlador dedicado ao Modo 1 — Sobrevivência por Rodadas (Etapa 1).
 * - Gera rodadas numeradas com quantidade finita de zumbis baseada em orçamento de ameaça.
 * - A cada 5 rodadas (`roundNumber % 5 === 0`), adiciona um inimigo de Elite garantido.
 * - Uma rodada só termina quando todos os zumbis da fila tiverem nascido e sido eliminados.
 * - Entre rodadas há um intervalo de 25 segundos (`INTERMISSION_DURATION_MS`), que pode ser
 *   antecipado quando todos os jogadores vivos e conectados concordarem (`readyForNextRound`).
 */
export class RoundsDirector {
  private rng: SeededRng;
  private roundNumber = 0;
  private roundPhase: RoundSubPhase = 'active';
  private isSpecialEliteRound = false;
  private threatBudget = 0;
  private roundTotalZombies = 0;
  private roundSpawnedZombies = 0;
  private roundsCompleted = 0;
  private intermissionRemainingMs = 0;
  private spawnTimerMs = 0;
  private readonly pendingQueue: QueuedRoundZombie[] = [];
  private readonly readyPlayerIds = new Set<string>();
  private initializedFirstRound = false;

  constructor(seed: number) {
    this.rng = new SeededRng((seed ^ 0x6a09e667) >>> 0);
  }

  reset(seed: number): void {
    this.rng = new SeededRng((seed ^ 0x6a09e667) >>> 0);
    this.roundNumber = 0;
    this.roundPhase = 'active';
    this.isSpecialEliteRound = false;
    this.threatBudget = 0;
    this.roundTotalZombies = 0;
    this.roundSpawnedZombies = 0;
    this.roundsCompleted = 0;
    this.intermissionRemainingMs = 0;
    this.spawnTimerMs = 0;
    this.pendingQueue.length = 0;
    this.readyPlayerIds.clear();
    this.initializedFirstRound = false;
  }

  /**
   * Registra que um jogador vivo concordou em antecipar a próxima rodada durante o intervalo de 25s.
   */
  requestNextRound(
    playerId: string,
    players: readonly PlayerStateSnapshot[],
    callbacks: RoundsDirectorCallbacks
  ): boolean {
    if (this.roundPhase !== 'intermission') {
      return false;
    }
    const player = players.find((p) => p.id === playerId);
    if (!player || !player.alive || !player.connected) {
      return false;
    }

    this.readyPlayerIds.add(playerId);
    player.readyForNextRound = true;

    if (this.allLivingConnectedPlayersReady(players)) {
      this.startNextRound(players, callbacks);
    }
    return true;
  }

  /**
   * Avança o diretor de rodadas por `dtMs`.
   */
  step(
    dtMs: number,
    players: readonly PlayerStateSnapshot[],
    zombies: readonly ZombieStateSnapshot[],
    callbacks: RoundsDirectorCallbacks
  ): void {
    const livingPlayers = players.filter((p) => p.alive);
    if (livingPlayers.length === 0) {
      return;
    }

    // Inicia a Rodada 1 assim que houver jogadores vivos na partida
    if (!this.initializedFirstRound) {
      this.initializedFirstRound = true;
      this.startNextRound(players, callbacks);
    }

    if (this.roundPhase === 'intermission') {
      this.syncPlayersReadyFlag(players);
      this.intermissionRemainingMs = Math.max(0, this.intermissionRemainingMs - dtMs);

      if (
        this.intermissionRemainingMs <= 0 ||
        this.allLivingConnectedPlayersReady(players)
      ) {
        this.startNextRound(players, callbacks);
      }
      return;
    }

    // Fase 'active': instancia zumbis da fila finita respeitando o teto MAX_ALIVE
    const spawnIntervalMs = Math.max(
      BALANCE.ROUNDS.SPAWN_INTERVAL_MIN_MS,
      BALANCE.ROUNDS.SPAWN_INTERVAL_BASE_MS - (this.roundNumber - 1) * 28
    );

    this.spawnTimerMs += dtMs;
    while (
      this.pendingQueue.length > 0 &&
      this.spawnTimerMs >= spawnIntervalMs &&
      zombies.length < BALANCE.SPAWN.MAX_ALIVE
    ) {
      this.spawnTimerMs -= spawnIntervalMs;
      const next = this.pendingQueue[0];
      const spawned = callbacks.spawnZombieFromDirector(next.kind, {
        isElite: next.isElite,
        spawnSource: 'round',
        speedMultiplier: next.speedMultiplier,
      });
      if (spawned) {
        this.pendingQueue.shift();
        this.roundSpawnedZombies += 1;
      } else {
        break;
      }
    }

    if (zombies.length >= BALANCE.SPAWN.MAX_ALIVE) {
      this.spawnTimerMs = Math.min(this.spawnTimerMs, spawnIntervalMs);
    }

    // Verifica se todos os zumbis da rodada já nasceram e foram eliminados
    const activeRoundZombies = zombies.filter((z) => z.hp > 0).length;
    if (this.pendingQueue.length === 0 && activeRoundZombies === 0) {
      this.roundsCompleted += 1;
      this.roundPhase = 'intermission';
      this.intermissionRemainingMs = BALANCE.ROUNDS.INTERMISSION_DURATION_MS;
      this.readyPlayerIds.clear();
      this.syncPlayersReadyFlag(players);

      callbacks.emitRoundCompleted({
        type: 'round_completed',
        roundNumber: this.roundNumber,
        intermissionMs: this.intermissionRemainingMs,
      });
    }
  }

  getStateSnapshot(
    players: readonly PlayerStateSnapshot[],
    zombies: readonly ZombieStateSnapshot[]
  ): RoundsModeStateSnapshot {
    const livingConnected = players.filter((p) => p.alive && p.connected);
    let readyCount = 0;
    for (const p of livingConnected) {
      if (this.readyPlayerIds.has(p.id) || p.readyForNextRound) {
        readyCount += 1;
      }
    }
    const activeAlive = zombies.filter((z) => z.hp > 0).length;
    const remaining =
      this.roundPhase === 'active'
        ? this.pendingQueue.length + activeAlive
        : 0;

    return {
      roundNumber: Math.max(1, this.roundNumber),
      roundPhase: this.roundPhase,
      isSpecialEliteRound: this.isSpecialEliteRound,
      roundTotalZombies: this.roundTotalZombies,
      roundSpawnedZombies: this.roundSpawnedZombies,
      roundRemainingZombies: remaining,
      intermissionRemainingMs:
        this.roundPhase === 'intermission' ? this.intermissionRemainingMs : 0,
      roundsCompleted: this.roundsCompleted,
      threatBudget: this.threatBudget,
      readyPlayersCount: readyCount,
      livingPlayersCount: livingConnected.length,
    };
  }

  private startNextRound(
    players: readonly PlayerStateSnapshot[],
    callbacks: RoundsDirectorCallbacks
  ): void {
    this.roundNumber += 1;
    this.roundPhase = 'active';
    this.intermissionRemainingMs = 0;
    this.readyPlayerIds.clear();
    this.syncPlayersReadyFlag(players);

    const activePlayersCount = Math.max(
      1,
      players.filter((p) => p.alive).length
    );
    this.isSpecialEliteRound =
      this.roundNumber % BALANCE.ROUNDS.ELITE_ROUND_INTERVAL === 0;
    this.threatBudget = computeRoundThreatBudget(
      this.roundNumber,
      activePlayersCount
    );

    this.buildRoundSpawnQueue(this.roundNumber, this.threatBudget, this.isSpecialEliteRound);
    this.roundTotalZombies = this.pendingQueue.length;
    this.roundSpawnedZombies = 0;
    // Permite spawn imediato do primeiro inimigo da rodada no tick de abertura
    this.spawnTimerMs = BALANCE.ROUNDS.SPAWN_INTERVAL_BASE_MS;

    callbacks.emitRoundStarted({
      type: 'round_started',
      roundNumber: this.roundNumber,
      totalZombies: this.roundTotalZombies,
      isSpecialEliteRound: this.isSpecialEliteRound,
    });
  }

  private buildRoundSpawnQueue(
    roundNumber: number,
    budget: number,
    includeElite: boolean
  ): void {
    this.pendingQueue.length = 0;
    let remainingBudget = budget;

    // A cada 5 rodadas, garante ao menos 1 inimigo de Elite
    if (includeElite) {
      this.pendingQueue.push({ kind: 'brute', isElite: true });
      remainingBudget = Math.max(
        4,
        remainingBudget - BALANCE.ROUNDS.THREAT_COST.ELITE
      );
    }

    // Na Rodada 1, começa com zumbis comuns (os primeiros mais lentos) para quem inicia de faca
    const allowFast = roundNumber >= 2;
    const allowBrute = roundNumber >= 2;

    while (remainingBudget > 0) {
      const roll = this.rng.nextFloat();
      const isOpeningSlow =
        roundNumber === 1 && this.pendingQueue.length < 5;
      const speedMultiplier = isOpeningSlow
        ? BALANCE.LOOT.STARTER_SLOW_ZOMBIE_SPEED_FACTOR
        : 1;

      if (
        allowBrute &&
        remainingBudget >= BALANCE.ROUNDS.THREAT_COST.BRUTE &&
        roll < Math.min(0.26, 0.08 + roundNumber * 0.02)
      ) {
        this.pendingQueue.push({ kind: 'brute', isElite: false, speedMultiplier });
        remainingBudget -= BALANCE.ROUNDS.THREAT_COST.BRUTE;
      } else if (
        allowFast &&
        remainingBudget >= BALANCE.ROUNDS.THREAT_COST.FAST &&
        roll < Math.min(0.58, 0.25 + roundNumber * 0.03)
      ) {
        this.pendingQueue.push({ kind: 'fast', isElite: false, speedMultiplier });
        remainingBudget -= BALANCE.ROUNDS.THREAT_COST.FAST;
      } else {
        this.pendingQueue.push({ kind: 'common', isElite: false, speedMultiplier });
        remainingBudget -= BALANCE.ROUNDS.THREAT_COST.COMMON;
      }
    }
  }

  private allLivingConnectedPlayersReady(
    players: readonly PlayerStateSnapshot[]
  ): boolean {
    const livingConnected = players.filter((p) => p.alive && p.connected);
    if (livingConnected.length === 0) {
      return false;
    }
    return livingConnected.every((p) => this.readyPlayerIds.has(p.id));
  }

  private syncPlayersReadyFlag(players: readonly PlayerStateSnapshot[]): void {
    for (const p of players) {
      p.readyForNextRound =
        this.roundPhase === 'intermission' && this.readyPlayerIds.has(p.id);
    }
  }
}
