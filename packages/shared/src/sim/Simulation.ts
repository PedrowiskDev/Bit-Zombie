import { BALANCE, getXpForLevel } from '../config/balance.js';
import { SpatialHashGrid } from '../math/collision.js';
import { SeededRng } from '../math/rng.js';
import {
  clampPositionToArena,
  normalizeInputVector,
  stepEntityMovement,
} from '../math/vec2.js';
import type {
  AimMode,
  GameEvent,
  GameMode,
  HordeClearedEvent,
  HordeStartedEvent,
  HordeWarningEvent,
  InputCmd,
  LevelUpEvent,
  PlayerDamagedEvent,
  PlayerRevivedEvent,
  PlayerSpawnedEvent,
  PlayerStateSnapshot,
  ProjectileHitEvent,
  PropData,
  RoundCompletedEvent,
  RoundStartedEvent,
  TickInputMap,
  UpgradeChosenEvent,
  WeaponFireEvent,
  WorldSnapshot,
  ZombieKind,
  ZombieStateSnapshot,
} from '../types/protocol.js';
import {
  resolvePlayerZombieCollisionsAndContactDamage,
  stepAutoFireWeapons,
  stepPlayerReviveMechanics,
  stepProjectilesAndHits,
  stepZombiesMovementAndSeparation,
  type PlayerManualAimInput,
  type SimulatedProjectile,
} from './combat.js';
import {
  ExplorationDirector,
  type ExplorationTimingOverrides,
} from './directors/ExplorationDirector.js';
import { RoundsDirector } from './directors/RoundsDirector.js';
import { generateMapProps } from './propsGenerator.js';
import {
  createZombieEntity,
  getZombieStats,
  pickRingSpawnPosition,
  pickZombieKind,
} from './spawner.js';
import {
  UPGRADE_CATALOG,
  computeEffectiveWeaponStats,
  getAutoBonusForLevel,
  getAutomaticUpgradesForLevel,
  isValidUpgradeId,
  rollUpgradeOptionsForPlayer,
  type AppliedUpgradeStack,
  type EffectiveWeaponStats,
  type PendingUpgradeOffer,
  type UpgradeId,
} from './upgrades.js';

export interface SimulationOptions {
  seed?: number;
  gameMode?: GameMode;
  mapWidth?: number;
  mapHeight?: number;
  /** Permite desativar o spawn automático por tempo/diretor em testes unitários isolados */
  enableAutoSpawn?: boolean;
  /** Permite sobrescrever tempos de horda em testes específicos do modo Exploração */
  explorationTimingOverrides?: ExplorationTimingOverrides;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * Simulação determinística pura (Fase 1 + Fase 2 + Etapa 1 Modos).
 * - Não importa Phaser nem Colyseus.
 * - Avança em passo fixo de 20 Hz (`TICK_DT_MS = 50` ms).
 * - Suporta os dois modos de jogo sobre o mesmo mapa-base (`'rounds'` e `'exploration'`).
 * - `getSnapshot()` lê o estado persistente sem efeitos colaterais.
 * - `consumeEvents()` retira e limpa a fila de eventos transitórios com `eventId` monotônico.
 */
export class Simulation {
  private seed: number;
  private gameMode: GameMode;
  private rng: SeededRng;
  private upgradeRng: SeededRng;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private readonly enableAutoSpawn: boolean;
  private props: PropData[];
  private readonly players: Map<string, PlayerStateSnapshot> = new Map();
  private readonly manualAimByPlayer: Map<string, PlayerManualAimInput> = new Map();
  private readonly upgradesByPlayer: Map<string, AppliedUpgradeStack[]> = new Map();
  private readonly pendingOffersByPlayer: Map<string, PendingUpgradeOffer[]> = new Map();
  private readonly zombies: ZombieStateSnapshot[] = [];
  private readonly projectiles: SimulatedProjectile[] = [];
  private readonly spatialGrid = new SpatialHashGrid<ZombieStateSnapshot>(64);
  private readonly extraUpgrades: AppliedUpgradeStack[] = [];
  private readonly roundsDirector: RoundsDirector;
  private readonly explorationDirector: ExplorationDirector;

  private pendingEvents: GameEvent[] = [];
  private tickCount = 0;
  private elapsedMs = 0;
  private nextEventId = 1;
  private nextZombieId = 1;
  private nextProjectileId = 1;

  private totalKills = 0;
  private totalDamageDealt = 0;
  private totalRevives = 0;
  private structuresBuilt = 0;
  private xp = 0;
  private level = 1;
  private lastLevelBonusLabel = '';
  private gameOver = false;

  constructor(options: SimulationOptions = {}) {
    this.seed = (options.seed ?? BALANCE.SIMULATION.DEFAULT_SEED) >>> 0;
    this.gameMode = options.gameMode === 'exploration' ? 'exploration' : 'rounds';
    this.rng = new SeededRng(this.seed);
    this.upgradeRng = new SeededRng((this.seed ^ 0x9e3779b9) >>> 0);
    this.mapWidth = options.mapWidth ?? BALANCE.MAP.WIDTH;
    this.mapHeight = options.mapHeight ?? BALANCE.MAP.HEIGHT;
    this.enableAutoSpawn = options.enableAutoSpawn ?? true;
    this.props = generateMapProps(this.seed);
    this.roundsDirector = new RoundsDirector(this.seed);
    this.explorationDirector = new ExplorationDirector(
      this.seed,
      this.mapWidth,
      this.mapHeight,
      options.explorationTimingOverrides
    );
  }

  getGameMode(): GameMode {
    return this.gameMode;
  }

  setGameMode(mode: GameMode): void {
    this.gameMode = mode === 'exploration' ? 'exploration' : 'rounds';
  }

  /**
   * Reinicia a partida com uma nova seed determinística (e opcionalmente um novo modo),
   * restaurando os jogadores conectados para o centro do mapa com vida máxima e zerando
   * diretores, ondas, nível, projéteis e estatísticas.
   */
  resetMatch(newSeed?: number, newGameMode?: GameMode): void {
    this.seed = (newSeed ?? (this.seed + 1)) >>> 0;
    if (newGameMode) {
      this.gameMode = newGameMode === 'exploration' ? 'exploration' : 'rounds';
    }
    this.rng = new SeededRng(this.seed);
    this.upgradeRng = new SeededRng((this.seed ^ 0x9e3779b9) >>> 0);
    this.props = generateMapProps(this.seed);
    this.roundsDirector.reset(this.seed);
    this.explorationDirector.reset(this.seed);
    this.zombies.length = 0;
    this.projectiles.length = 0;
    this.pendingEvents.length = 0;
    this.tickCount = 0;
    this.elapsedMs = 0;
    this.nextEventId = 1;
    this.nextZombieId = 1;
    this.nextProjectileId = 1;
    this.totalKills = 0;
    this.totalDamageDealt = 0;
    this.totalRevives = 0;
    this.structuresBuilt = 0;
    this.xp = 0;
    this.level = 1;
    this.lastLevelBonusLabel = '';
    this.extraUpgrades.length = 0;

    let idx = 0;
    for (const player of this.players.values()) {
      const spawnX = BALANCE.PLAYER.SPAWN_X + (idx === 0 ? 0 : 48);
      const spawnY = BALANCE.PLAYER.SPAWN_Y;
      player.x = spawnX;
      player.y = spawnY;
      player.vx = 0;
      player.vy = 0;
      player.facingAngle = 0;
      player.hp = BALANCE.PLAYER.MAX_HP;
      player.maxHp = BALANCE.PLAYER.MAX_HP;
      player.alive = true;
      player.invulnMs = 0;
      player.fireCooldownMs = 0;
      player.kills = 0;
      player.lastProcessedSeq = 0;
      player.reviveProgress = 0;
      player.pendingUpgradeOptions = [];
      player.pendingUpgradeTimerMs = 0;
      player.upgradesChosenCount = 0;
      player.readyForNextRound = false;
      player.damageDealt = 0;
      player.revivesCount = 0;
      this.upgradesByPlayer.set(player.id, []);
      this.pendingOffersByPlayer.set(player.id, []);
      idx += 1;
    }

    this.updateGameOverFlag();
  }

  /**
   * Adiciona um jogador à simulação em posição determinística e válida dentro da arena.
   */
  addPlayer(
    playerId: string,
    spawnPos?: { x: number; y: number },
    colorIndex?: number
  ): PlayerStateSnapshot {
    const existing = this.players.get(playerId);
    if (existing) {
      return { ...existing };
    }

    const index = colorIndex ?? this.players.size;
    const defaultX = BALANCE.PLAYER.SPAWN_X + (index === 0 ? 0 : 48);
    const defaultY = BALANCE.PLAYER.SPAWN_Y;
    const rawX = spawnPos?.x ?? defaultX;
    const rawY = spawnPos?.y ?? defaultY;

    const clamped = clampPositionToArena(
      rawX,
      rawY,
      BALANCE.PLAYER.RADIUS,
      this.mapWidth,
      this.mapHeight
    );

    const player: PlayerStateSnapshot = {
      id: playerId,
      x: clamped.x,
      y: clamped.y,
      vx: 0,
      vy: 0,
      facingAngle: 0,
      radius: BALANCE.PLAYER.RADIUS,
      hp: BALANCE.PLAYER.MAX_HP,
      maxHp: BALANCE.PLAYER.MAX_HP,
      alive: true,
      connected: true,
      ready: false,
      colorIndex: index,
      aimMode: 'auto',
      invulnMs: 0,
      fireCooldownMs: 0,
      kills: 0,
      lastProcessedSeq: 0,
      reviveProgress: 0,
      pendingUpgradeOptions: [],
      pendingUpgradeTimerMs: 0,
      upgradesChosenCount: 0,
      readyForNextRound: false,
      damageDealt: 0,
      revivesCount: 0,
    };

    this.players.set(playerId, player);
    this.upgradesByPlayer.set(playerId, []);
    this.pendingOffersByPlayer.set(playerId, []);
    this.manualAimByPlayer.set(playerId, {
      aimMode: 'auto',
      aimX: 0,
      aimY: 0,
      firing: false,
    });
    this.updateGameOverFlag();

    const spawnEv: Omit<PlayerSpawnedEvent, 'eventId' | 'tick'> = {
      type: 'player_spawned',
      playerId,
      x: player.x,
      y: player.y,
    };
    this.emitEvent(spawnEv);

    return { ...player };
  }

  removePlayer(playerId: string): boolean {
    this.manualAimByPlayer.delete(playerId);
    this.upgradesByPlayer.delete(playerId);
    this.pendingOffersByPlayer.delete(playerId);
    const existed = this.players.delete(playerId);
    this.updateGameOverFlag();
    return existed;
  }

  /**
   * Atualiza o estado de conexão de um jogador (ex.: desconexão com janela de 20s).
   * Enquanto `connected === false`, o jogador fica parado e invulnerável.
   */
  setPlayerConnected(playerId: string, connected: boolean): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }
    player.connected = connected;
    if (!connected) {
      player.vx = 0;
      player.vy = 0;
    }
  }

  setPlayerReady(playerId: string, ready: boolean): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }
    player.ready = ready;
  }

  setPlayerAimMode(playerId: string, aimMode: AimMode): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }
    player.aimMode = aimMode;
    const prev = this.manualAimByPlayer.get(playerId) ?? {
      aimMode,
      aimX: 0,
      aimY: 0,
      firing: false,
    };
    prev.aimMode = aimMode;
    if (aimMode === 'auto') {
      prev.firing = false;
    }
    this.manualAimByPlayer.set(playerId, prev);
  }

  /**
   * Instancia manualmente um zumbi (ou via diretor de modo) respeitando os limites do mapa
   * e o teto `BALANCE.SPAWN.MAX_ALIVE` (150).
   */
  spawnZombie(
    kind?: ZombieKind,
    position?: { x: number; y: number },
    options?: {
      isElite?: boolean;
      spawnSource?: ZombieStateSnapshot['spawnSource'];
    }
  ): ZombieStateSnapshot | null {
    if (this.zombies.length >= BALANCE.SPAWN.MAX_ALIVE) {
      return null;
    }

    const resolvedKind = kind ?? pickZombieKind(this.rng, this.elapsedMs);
    const isElite = Boolean(options?.isElite);
    const stats = getZombieStats(resolvedKind, isElite);

    let spawnCoords: { x: number; y: number };
    if (position) {
      spawnCoords = clampPositionToArena(
        position.x,
        position.y,
        stats.radius,
        this.mapWidth,
        this.mapHeight
      );
    } else {
      const livingPlayers = this.getLivingPlayers();
      spawnCoords = pickRingSpawnPosition(
        this.rng,
        livingPlayers,
        stats.radius,
        this.mapWidth,
        this.mapHeight
      );
    }

    const zombie = createZombieEntity(
      this.nextZombieId++,
      resolvedKind,
      spawnCoords.x,
      spawnCoords.y,
      {
        isElite,
        spawnSource: options?.spawnSource ?? 'manual',
      }
    );
    this.zombies.push(zombie);
    return { ...zombie };
  }

  /**
   * Permite a um jogador vivo e conectado concordar em antecipar a próxima rodada
   * durante o intervalo de 25s no Modo 1 (Sobrevivência por Rodadas).
   */
  requestSkipRoundIntermission(playerId: string): boolean {
    if (this.gameMode !== 'rounds' || this.gameOver) {
      return false;
    }
    const playerList = Array.from(this.players.values());
    return this.roundsDirector.requestNextRound(playerId, playerList, {
      spawnZombieFromDirector: (kind, opts) =>
        this.spawnZombie(kind, undefined, opts),
      emitRoundStarted: (ev: Omit<RoundStartedEvent, 'eventId' | 'tick'>) =>
        this.emitEvent(ev),
      emitRoundCompleted: (ev: Omit<RoundCompletedEvent, 'eventId' | 'tick'>) =>
        this.emitEvent(ev),
    });
  }

  /**
   * Permite ajustar o HP de um jogador (usado em testes ou fim da janela de 20s de desconexão)
   * e recalcula estado de vida e fim de jogo.
   */
  setPlayerHp(playerId: string, hp: number): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }
    player.hp = Math.max(0, Math.min(player.maxHp, hp));
    if (player.hp <= 0) {
      player.alive = false;
      player.vx = 0;
      player.vy = 0;
      player.readyForNextRound = false;
    } else {
      player.alive = true;
    }
    this.updateGameOverFlag();
  }

  /**
   * Retorna os stacks de upgrades ativos da dupla ou de um jogador específico.
   */
  getAppliedUpgrades(playerId?: string): AppliedUpgradeStack[] {
    if (playerId) {
      const pUpgrades = this.upgradesByPlayer.get(playerId) ?? [];
      return [...getAutomaticUpgradesForLevel(this.level), ...pUpgrades];
    }
    return [...getAutomaticUpgradesForLevel(this.level), ...this.extraUpgrades];
  }

  /**
   * Retorna a oferta pendente atual de upgrade para o jogador (ou `null` se não houver).
   */
  getPlayerPendingOffer(playerId: string): PendingUpgradeOffer | null {
    const queue = this.pendingOffersByPlayer.get(playerId);
    if (!queue || queue.length === 0) {
      return null;
    }
    return {
      levelReached: queue[0].levelReached,
      options: [...queue[0].options],
      selectedUpgradeId: queue[0].selectedUpgradeId,
      remainingMs: queue[0].remainingMs,
    };
  }

  /**
   * Retorna os atributos efetivos da arma e do jogador `playerId` combinando o nível e seus upgrades da Fase 2.
   */
  getPlayerEffectiveStats(playerId: string): EffectiveWeaponStats {
    const playerStacks = this.upgradesByPlayer.get(playerId) ?? [];
    return computeEffectiveWeaponStats(this.level, playerStacks);
  }

  /**
   * Aplica a escolha interativa (ou automática por timeout) de um upgrade da Fase 2 para `playerId`.
   */
  chooseUpgrade(
    playerId: string,
    upgradeId?: unknown,
    autoSelected = false
  ): boolean {
    const player = this.players.get(playerId);
    const queue = this.pendingOffersByPlayer.get(playerId);
    if (!player || !queue || queue.length === 0) {
      return false;
    }

    const currentOffer = queue[0];
    let resolvedId: UpgradeId | null = null;

    if (isValidUpgradeId(upgradeId) && currentOffer.options.includes(upgradeId)) {
      resolvedId = upgradeId;
    } else if (autoSelected && currentOffer.options.length > 0) {
      resolvedId = currentOffer.options[0];
    } else {
      return false;
    }

    queue.shift();

    const playerStacks = this.upgradesByPlayer.get(playerId) ?? [];
    const existing = playerStacks.find((s) => s.upgradeId === resolvedId);
    const def = UPGRADE_CATALOG[resolvedId];
    if (existing) {
      existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
    } else {
      playerStacks.push({ upgradeId: resolvedId, stacks: 1 });
    }
    this.upgradesByPlayer.set(playerId, playerStacks);

    // Mantém sincronizado também em extraUpgrades para exibição nas métricas gerais da partida
    const globalExisting = this.extraUpgrades.find((s) => s.upgradeId === resolvedId);
    if (globalExisting) {
      globalExisting.stacks = Math.min(def.maxStacks, globalExisting.stacks + 1);
    } else {
      this.extraUpgrades.push({ upgradeId: resolvedId, stacks: 1 });
    }

    // Se o upgrade concede vida máxima / cura imediata, aplica ao jogador
    if (def.modifiersPerStack.maxHpBonus) {
      player.maxHp += def.modifiersPerStack.maxHpBonus;
    }
    if (def.modifiersPerStack.instantHealHp && player.alive) {
      player.hp = Math.min(
        player.maxHp,
        player.hp + def.modifiersPerStack.instantHealHp
      );
    }

    player.upgradesChosenCount = (player.upgradesChosenCount ?? 0) + 1;
    this.lastLevelBonusLabel = `${def.name} (${def.description})`;
    this.syncPlayerOfferSnapshotFields(playerId);

    const chosenEv: Omit<UpgradeChosenEvent, 'eventId' | 'tick'> = {
      type: 'upgrade_chosen',
      playerId,
      upgradeId: resolvedId,
      upgradeName: def.name,
      autoSelected,
    };
    this.emitEvent(chosenEv);
    return true;
  }

  /**
   * Avança a simulação pelo tempo `dtMs` em passos fixos de `50 ms` (20 Hz).
   * Quando `gameOver === true` (todos os jogadores morreram), o estado da partida congela.
   */
  step(dtMs: number, inputs: TickInputMap = {}): void {
    if (this.gameOver) {
      return;
    }

    const safeDtMs =
      Number.isFinite(dtMs) && dtMs > 0 ? dtMs : BALANCE.SIMULATION.TICK_DT_MS;
    const steps = Math.max(1, Math.round(safeDtMs / BALANCE.SIMULATION.TICK_DT_MS));
    const tickDtMs = BALANCE.SIMULATION.TICK_DT_MS;
    const tickDtSec = BALANCE.SIMULATION.TICK_DT_SEC;

    for (let s = 0; s < steps; s += 1) {
      if (this.gameOver) {
        break;
      }

      this.tickCount += 1;
      this.elapsedMs = this.tickCount * tickDtMs;

      // 0. Atualiza temporizadores de ofertas de upgrade pendentes (auto-seleção aos 12 s sem pausar o coop)
      this.stepPendingUpgradeOffers(tickDtMs);

      // 1. Atualiza contadores de invulnerabilidade/cooldown e move jogadores vivos e conectados
      for (const [playerId, player] of this.players.entries()) {
        if (player.invulnMs > 0) {
          player.invulnMs = Math.max(0, player.invulnMs - tickDtMs);
        }
        if (player.fireCooldownMs > 0) {
          player.fireCooldownMs = Math.max(0, player.fireCooldownMs - tickDtMs);
        }

        if (!player.alive || !player.connected) {
          player.vx = 0;
          player.vy = 0;
          continue;
        }

        const rawCmd: InputCmd | undefined = s === 0 ? inputs[playerId] : undefined;
        let dx = 0;
        let dy = 0;

        if (rawCmd && this.isValidNewCommand(rawCmd, player.lastProcessedSeq)) {
          dx = rawCmd.dx;
          dy = rawCmd.dy;
          player.lastProcessedSeq = rawCmd.seq;

          const aimState = this.manualAimByPlayer.get(playerId) ?? {
            aimMode: player.aimMode ?? 'auto',
            aimX: 0,
            aimY: 0,
            firing: false,
          };

          if (rawCmd.aimMode === 'manual' || rawCmd.aimMode === 'auto') {
            aimState.aimMode = rawCmd.aimMode;
            player.aimMode = rawCmd.aimMode;
          }
          if (
            typeof rawCmd.aimX === 'number' &&
            typeof rawCmd.aimY === 'number' &&
            Number.isFinite(rawCmd.aimX) &&
            Number.isFinite(rawCmd.aimY)
          ) {
            const normAim = normalizeInputVector(rawCmd.aimX, rawCmd.aimY);
            aimState.aimX = normAim.x;
            aimState.aimY = normAim.y;
          }
          if (typeof rawCmd.firing === 'boolean') {
            aimState.firing = rawCmd.firing;
          } else if (aimState.aimMode === 'auto') {
            aimState.firing = false;
          }
          this.manualAimByPlayer.set(playerId, aimState);
        }

        const effectivePlayerStats = this.getPlayerEffectiveStats(playerId);
        const moved = stepEntityMovement(
          player.x,
          player.y,
          dx,
          dy,
          effectivePlayerStats.moveSpeedPxPerSec,
          tickDtSec,
          player.radius,
          this.mapWidth,
          this.mapHeight
        );

        player.x = moved.x;
        player.y = moved.y;
        player.vx = moved.vx;
        player.vy = moved.vy;

        const currentAim = this.manualAimByPlayer.get(playerId);
        if (
          currentAim?.aimMode === 'manual' &&
          (currentAim.aimX !== 0 || currentAim.aimY !== 0)
        ) {
          player.facingAngle = Math.atan2(currentAim.aimY, currentAim.aimX);
        } else if (moved.vx !== 0 || moved.vy !== 0) {
          player.facingAngle = Math.atan2(moved.vy, moved.vx);
        }
      }

      const playerList = Array.from(this.players.values());

      // 2. Mecânica cooperativa de reviver aliado caído (Fase 2)
      stepPlayerReviveMechanics(
        playerList,
        tickDtMs,
        (ev: Omit<PlayerRevivedEvent, 'eventId' | 'tick'>) => {
          this.totalRevives += 1;
          this.emitEvent(ev);
        }
      );

      // 3. Movimento de perseguição dos zumbis existentes e separação suave entre zumbis
      stepZombiesMovementAndSeparation(
        this.zombies,
        playerList,
        tickDtSec,
        this.mapWidth,
        this.mapHeight,
        this.spatialGrid
      );

      // 4. Colisão círculo-círculo jogador-zumbi e dano de contato com invulnerabilidade (0,8 s)
      resolvePlayerZombieCollisionsAndContactDamage(
        playerList,
        this.zombies,
        this.mapWidth,
        this.mapHeight,
        (ev: Omit<PlayerDamagedEvent, 'eventId' | 'tick'>) => this.emitEvent(ev)
      );

      // 5. Mira e disparo (automático ou manual) com atributos efetivos por jogador (incluindo multishot e perfuração)
      const defaultWeaponStats = computeEffectiveWeaponStats(this.level, this.extraUpgrades);
      stepAutoFireWeapons(
        playerList,
        this.zombies,
        this.projectiles,
        () => this.nextProjectileId++,
        (ev: Omit<WeaponFireEvent, 'eventId' | 'tick'>) => this.emitEvent(ev),
        defaultWeaponStats,
        this.manualAimByPlayer,
        (pid) => this.getPlayerEffectiveStats(pid)
      );

      // 6. Simulação dos projéteis e detecção de acerto/abate/perfuração
      stepProjectilesAndHits(
        this.projectiles,
        this.zombies,
        this.players,
        tickDtSec,
        this.mapWidth,
        this.mapHeight,
        (zombie) => this.handleZombieKilled(zombie),
        (ev: Omit<ProjectileHitEvent, 'eventId' | 'tick'>) => this.emitEvent(ev),
        (damage) => {
          this.totalDamageDealt = Number((this.totalDamageDealt + damage).toFixed(1));
        }
      );

      // 7. Diretor dedicado do modo ativo ('rounds' ou 'exploration'), isolando completamente os spawns de cada modo
      if (this.enableAutoSpawn) {
        this.stepActiveModeDirector(tickDtMs, playerList);
      }

      // 8. Verifica se todos os jogadores morreram (Fim de Jogo)
      this.updateGameOverFlag();
    }
  }

  /**
   * Leitura pura (sem efeitos colaterais) do estado persistente atual da simulação.
   * Não consome nem limpa eventos transitórios.
   */
  getSnapshot(): WorldSnapshot {
    const playersCopy: PlayerStateSnapshot[] = [];
    for (const p of this.players.values()) {
      playersCopy.push({
        ...p,
        pendingUpgradeOptions: p.pendingUpgradeOptions
          ? [...p.pendingUpgradeOptions]
          : [],
      });
    }

    const zombiesCopy: ZombieStateSnapshot[] = this.zombies.map((z) => ({ ...z }));
    const weaponStats = computeEffectiveWeaponStats(this.level, this.extraUpgrades);
    const roundsState = this.roundsDirector.getStateSnapshot(playersCopy, zombiesCopy);
    const explorationState = this.explorationDirector.getStateSnapshot(
      this.elapsedMs,
      zombiesCopy
    );

    return {
      protocolVersion: BALANCE.PROTOCOL_VERSION,
      gameMode: this.gameMode,
      tick: this.tickCount,
      elapsedMs: this.elapsedMs,
      seed: this.seed,
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      gameOver: this.gameOver,
      kills: this.totalKills,
      xp: this.xp,
      level: this.level,
      xpToNextLevel: getXpForLevel(this.level),
      weaponDamage: weaponStats.damage,
      weaponFireRate: weaponStats.fireRatePerSec,
      lastLevelBonusLabel: this.lastLevelBonusLabel,
      totalDamageDealt: this.totalDamageDealt,
      totalRevives: this.totalRevives,
      structuresBuilt: this.structuresBuilt,
      roundsState,
      explorationState,
      players: playersCopy,
      zombies: zombiesCopy,
      props: this.props.map((prop) => ({ ...prop })),
    };
  }

  /**
   * Consome explicitamente e esvazia a fila de eventos transitórios acumulados.
   * Cada evento possui `eventId` único e monotônico dentro da partida.
   */
  consumeEvents(): GameEvent[] {
    if (this.pendingEvents.length === 0) {
      return [];
    }
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  /** Expõe o número de projéteis ativos na simulação (para inspeção em testes unitários) */
  getActiveProjectileCount(): number {
    return this.projectiles.length;
  }

  /** Expõe o estado interno do RNG apenas para verificação de determinismo em testes */
  getRngState(): number {
    return this.rng.getState();
  }

  private stepActiveModeDirector(
    dtMs: number,
    playerList: PlayerStateSnapshot[]
  ): void {
    if (this.gameMode === 'rounds') {
      this.roundsDirector.step(dtMs, playerList, this.zombies, {
        spawnZombieFromDirector: (kind, opts) =>
          this.spawnZombie(kind, undefined, opts),
        emitRoundStarted: (ev: Omit<RoundStartedEvent, 'eventId' | 'tick'>) =>
          this.emitEvent(ev),
        emitRoundCompleted: (ev: Omit<RoundCompletedEvent, 'eventId' | 'tick'>) =>
          this.emitEvent(ev),
      });
    } else {
      this.explorationDirector.step(dtMs, playerList, this.zombies, {
        spawnZombieFromDirector: (kind, opts) =>
          this.spawnZombie(kind, opts.position, {
            isElite: opts.isElite,
            spawnSource: opts.spawnSource,
          }),
        emitHordeWarning: (ev: Omit<HordeWarningEvent, 'eventId' | 'tick'>) =>
          this.emitEvent(ev),
        emitHordeStarted: (ev: Omit<HordeStartedEvent, 'eventId' | 'tick'>) =>
          this.emitEvent(ev),
        emitHordeCleared: (ev: Omit<HordeClearedEvent, 'eventId' | 'tick'>) =>
          this.emitEvent(ev),
      });
    }
  }

  /**
   * Adiciona XP compartilhado à dupla, processa subidas de nível e gera ofertas
   * interativas de 3 cartas de upgrade para cada jogador na Fase 2.
   */
  addSharedXp(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }
    this.xp += amount;

    let needed = getXpForLevel(this.level);
    while (this.xp >= needed) {
      this.xp -= needed;
      this.level += 1;
      needed = getXpForLevel(this.level);

      const bonus = getAutoBonusForLevel(this.level);
      this.lastLevelBonusLabel = bonus.bonusLabel;
      const updatedWeapon = computeEffectiveWeaponStats(this.level, this.extraUpgrades);

      // Gera oferta de 3 upgrades distintos para cada jogador da partida (Fase 2)
      for (const playerId of this.players.keys()) {
        const currentStacks = this.upgradesByPlayer.get(playerId) ?? [];
        const options = rollUpgradeOptionsForPlayer(
          this.upgradeRng,
          currentStacks,
          BALANCE.XP.UPGRADE_OPTIONS_COUNT
        );
        if (options.length > 0) {
          const queue = this.pendingOffersByPlayer.get(playerId) ?? [];
          queue.push({
            levelReached: this.level,
            options,
            selectedUpgradeId: null,
            remainingMs: BALANCE.XP.UPGRADE_OFFER_TIMEOUT_MS,
          });
          this.pendingOffersByPlayer.set(playerId, queue);
          this.syncPlayerOfferSnapshotFields(playerId);
        }
      }

      const levelUpEv: Omit<LevelUpEvent, 'eventId' | 'tick'> = {
        type: 'level_up',
        newLevel: this.level,
        bonusKind: bonus.bonusKind,
        bonusLabel: bonus.bonusLabel,
        weaponDamage: updatedWeapon.damage,
        weaponFireRate: updatedWeapon.fireRatePerSec,
      };
      this.emitEvent(levelUpEv);
    }
  }

  private stepPendingUpgradeOffers(dtMs: number): void {
    for (const [playerId, queue] of this.pendingOffersByPlayer.entries()) {
      if (queue.length === 0) {
        continue;
      }
      const activeOffer = queue[0];
      const nextRemaining = Math.max(
        0,
        (activeOffer.remainingMs ?? BALANCE.XP.UPGRADE_OFFER_TIMEOUT_MS) - dtMs
      );
      activeOffer.remainingMs = nextRemaining;
      this.syncPlayerOfferSnapshotFields(playerId);

      if (nextRemaining <= 0) {
        this.chooseUpgrade(playerId, activeOffer.options[0], true);
      }
    }
  }

  private syncPlayerOfferSnapshotFields(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }
    const queue = this.pendingOffersByPlayer.get(playerId);
    if (queue && queue.length > 0) {
      player.pendingUpgradeOptions = [...queue[0].options];
      player.pendingUpgradeTimerMs = queue[0].remainingMs ?? 0;
    } else {
      player.pendingUpgradeOptions = [];
      player.pendingUpgradeTimerMs = 0;
    }
  }

  private handleZombieKilled(zombie: ZombieStateSnapshot): void {
    this.totalKills += 1;
    const stats = getZombieStats(zombie.kind, zombie.isElite);
    this.addSharedXp(stats.xp);
  }

  private getLivingPlayers(): PlayerStateSnapshot[] {
    const living: PlayerStateSnapshot[] = [];
    for (const p of this.players.values()) {
      if (p.alive) {
        living.push(p);
      }
    }
    return living;
  }

  private updateGameOverFlag(): void {
    if (this.players.size === 0) {
      this.gameOver = false;
      return;
    }
    let anyAlive = false;
    for (const p of this.players.values()) {
      if (p.alive) {
        anyAlive = true;
        break;
      }
    }
    this.gameOver = !anyAlive;
  }

  private isValidNewCommand(cmd: InputCmd, lastProcessedSeq: number): boolean {
    if (typeof cmd !== 'object' || cmd === null) {
      return false;
    }
    if (!Number.isSafeInteger(cmd.seq) || cmd.seq <= lastProcessedSeq) {
      return false;
    }
    if (!Number.isFinite(cmd.dx) || !Number.isFinite(cmd.dy)) {
      return false;
    }
    return true;
  }

  private emitEvent(event: DistributiveOmit<GameEvent, 'eventId' | 'tick'>): void {
    this.pendingEvents.push({
      ...event,
      eventId: this.nextEventId++,
      tick: this.tickCount,
    } as GameEvent);
  }
}
