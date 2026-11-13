import { Client, Room, getStateCallbacks } from 'colyseus.js';
import {
  BALANCE,
  buildObstaclesFromProps,
  generateMapProps,
  interpolateRemoteEntities,
  normalizeInputVector,
  reconcileLocalPlayer,
  stepEntityMovement,
  type AmmoType,
  type BuildableStructureSnapshot,
  type EquippedSlotId,
  type ExplorationModeStateSnapshot,
  type ExplorationSubPhase,
  type GameEvent,
  type GameMode,
  type InputCmd,
  type LootContainerKind,
  type LootContainerSnapshot,
  type MeleeAttackPhase,
  type PlayerStateSnapshot,
  type PropData,
  type RoomPhase,
  type RoundSubPhase,
  type RoundsModeStateSnapshot,
  type StructureKind,
  type TimedEntitySnapshot,
  type Vec2,
  type VisionObstacles,
  type WeaponId,
  type WorldLootItemSnapshot,
  type ZombieKind,
  type ZombieStateSnapshot,
} from '@zombie-coop/shared';
import type {
  FrameAimInput,
  IWorldProvider,
  RenderWorldState,
} from './WorldProvider.js';

interface RemotePlayerSchemaView {
  id: string;
  colorIndex: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingAngle: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  connected: boolean;
  ready: boolean;
  aimMode: string;
  invulnMs: number;
  kills: number;
  lastProcessedSeq: number;
  reviveProgress: number;
  pendingUpgradesCsv: string;
  pendingUpgradeTimerMs: number;
  upgradesChosenCount: number;
  readyForNextRound: boolean;
  damageDealt: number;
  revivesCount: number;
  activeSlot?: string;
  activeWeaponId?: string;
  slot1WeaponId?: string;
  slot2WeaponId?: string;
  slot1MagAmmo?: number;
  slot2MagAmmo?: number;
  ammoLight?: number;
  ammoShells?: number;
  ammoHeavy?: number;
  reloadRemainingMs?: number;
  reloadTotalMs?: number;
  meleePhase?: string;
  wood?: number;
  scrap?: number;
  medkits?: number;
}

interface RemoteZombieSchemaView {
  id: number;
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingAngle: number;
  radius: number;
  hp: number;
  maxHp: number;
  isElite: boolean;
}

interface RemoteLootItemSchemaView {
  id: number;
  kind: string;
  x: number;
  y: number;
  weaponId: string;
  magAmmo: number;
  ammoType: string;
  ammoAmount: number;
  label: string;
}

interface RemoteLootContainerSchemaView {
  id: number;
  kind: string;
  x: number;
  y: number;
  opened: boolean;
  label: string;
}

interface RemoteStructureSchemaView {
  id: number;
  kind: string;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  ownerId: string;
  label: string;
}

interface RemoteRoomStateView {
  protocolVersion: number;
  roomCode: string;
  gameMode: GameMode;
  phase: RoomPhase;
  countdownMs: number;
  tick: number;
  elapsedMs: number;
  seed: number;
  mapWidth: number;
  mapHeight: number;
  gameOver: boolean;
  kills: number;
  totalDamageDealt: number;
  totalRevives: number;
  structuresBuilt: number;
  xp: number;
  level: number;
  xpToNextLevel: number;
  weaponDamage: number;
  weaponFireRate: number;
  lastLevelBonusLabel: string;
  roundNumber: number;
  roundPhase: RoundSubPhase;
  isSpecialEliteRound: boolean;
  roundTotalZombies: number;
  roundRemainingZombies: number;
  intermissionRemainingMs: number;
  roundsCompleted: number;
  explorationPhase: ExplorationSubPhase;
  daysSurvived: number;
  hordeNumber: number;
  hordesCleared: number;
  timeUntilNextHordeMs: number;
  warningRemainingMs: number;
  recoveryRemainingMs: number;
  hordeTotalZombies: number;
  hordeRemainingZombies: number;
  sectorsExplored: number;
  players: Map<string, RemotePlayerSchemaView>;
  zombies: Map<string, RemoteZombieSchemaView>;
  lootItems: Map<string, RemoteLootItemSchemaView>;
  lootContainers: Map<string, RemoteLootContainerSchemaView>;
  structures: Map<string, RemoteStructureSchemaView>;
}

export interface OnlineProviderCallbacks {
  onPhaseChange?: (phase: RoomPhase, roomCode: string) => void;
  onConnectionLost?: (reason: string) => void;
}

export interface CreateRoomClientOptions {
  gameMode?: GameMode;
  seed?: number;
}

/**
 * Provider multiplayer online usando Colyseus 0.16 (`colyseus.js@0.16.22`).
 * - Padronizado com `getStateCallbacks(room)` (`$(room.state).players.onAdd(...)`, `$(player).onChange(...)`).
 * - Predição local em passo fixo de 50 ms (20 Hz) e reconciliação pelo `lastProcessedSeq`.
 * - Interpolação de ~100 ms para o outro jogador e para os zumbis.
 * - Suporte a `?lag=N` para simular latência de rede e medição de Ping + Bytes/s (`rxBytesPerSec` / `txBytesPerSec`).
 * - Tentativa automática de reconexão dentro da janela de 20 s em caso de queda inesperada.
 */
export class OnlineProvider implements IWorldProvider {
  public readonly mode = 'online' as const;
  public localPlayerId: string;

  private readonly client: Client;
  private room: Room<RemoteRoomStateView>;
  private readonly callbacks: OnlineProviderCallbacks;
  private readonly simulatedLagMs: number;

  private roomCode = '';
  private gameMode: GameMode = 'rounds';
  private phase: RoomPhase = 'lobby';
  private countdownMs: number = BALANCE.NETWORK.COUNTDOWN_DURATION_MS;
  private tick = 0;
  private elapsedMs = 0;
  private seed: number = BALANCE.SIMULATION.DEFAULT_SEED;
  private mapWidth: number = BALANCE.MAP.WIDTH;
  private mapHeight: number = BALANCE.MAP.HEIGHT;
  private gameOver = false;
  private kills = 0;
  private totalDamageDealt = 0;
  private totalRevives = 0;
  private structuresBuilt = 0;
  private xp = 0;
  private level = 1;
  private xpToNextLevel: number = BALANCE.XP.BASE_XP;
  private weaponDamage: number = BALANCE.PISTOL.DAMAGE;
  private weaponFireRate: number = BALANCE.PISTOL.FIRE_RATE_PER_SEC;
  private lastLevelBonusLabel = '';
  private props: PropData[] = generateMapProps(BALANCE.SIMULATION.DEFAULT_SEED);
  private visionObstacles: VisionObstacles = buildObstaclesFromProps(this.props);

  private roundsState: RoundsModeStateSnapshot = {
    roundNumber: 1,
    roundPhase: 'active',
    isSpecialEliteRound: false,
    roundTotalZombies: 0,
    roundSpawnedZombies: 0,
    roundRemainingZombies: 0,
    intermissionRemainingMs: 0,
    roundsCompleted: 0,
    threatBudget: BALANCE.ROUNDS.BASE_THREAT_BUDGET,
    readyPlayersCount: 0,
    livingPlayersCount: 1,
  };

  private explorationState: ExplorationModeStateSnapshot = {
    explorationPhase: 'exploring',
    daysSurvived: 1,
    dayProgressRatio: 0,
    hordeNumber: 0,
    hordesCleared: 0,
    timeUntilNextHordeMs: BALANCE.EXPLORATION.FIRST_HORDE_DELAY_MS,
    warningRemainingMs: 0,
    recoveryRemainingMs: 0,
    hordeTotalZombies: 0,
    hordeSpawnedZombies: 0,
    hordeRemainingZombies: 0,
    ambientZombiesAlive: 0,
    sectorsExplored: 1,
    totalSectors: 64,
  };

  // Estado autoritativo mais recente recebido do servidor
  private readonly authoritativePlayers = new Map<string, PlayerStateSnapshot>();
  private readonly authoritativeZombies = new Map<number, ZombieStateSnapshot>();
  private readonly authoritativeLootItems = new Map<number, WorldLootItemSnapshot>();
  private readonly authoritativeLootContainers = new Map<number, LootContainerSnapshot>();
  private readonly authoritativeStructures = new Map<number, BuildableStructureSnapshot>();

  // Predição e reconciliação do jogador local
  private pendingInputs: InputCmd[] = [];
  private nextSeq = 1;
  private localAccumulatorMs = 0;
  private prevPredictedLocal: PlayerStateSnapshot | null = null;
  private currPredictedLocal: PlayerStateSnapshot | null = null;

  // Buffer de snapshots para interpolação de ~100 ms das entidades remotas
  private readonly snapshotBuffer: TimedEntitySnapshot[] = [];
  private estimatedServerTimeMs = 0;
  private hasServerTimeEstimate = false;

  // Fila de eventos transitórios (fire, hit, player_hit) com regra de consumo único
  private pendingEvents: GameEvent[] = [];
  private lastConsumedEventId = 0;

  // Telemetria (Ping e Bytes/s)
  private pingMs = 0;
  private pingTimerId: number | null = null;
  private rxBytesWindow = 0;
  private txBytesWindow = 0;
  private rxBytesPerSec = 0;
  private txBytesPerSec = 0;
  private telemetryWindowStartMs = performance.now();

  private manualDisconnect = false;
  private reconnecting = false;
  private lastReconnectionToken: string | null = null;

  private constructor(
    client: Client,
    room: Room<RemoteRoomStateView>,
    simulatedLagMs: number,
    callbacks: OnlineProviderCallbacks
  ) {
    this.client = client;
    this.room = room;
    this.localPlayerId = room.sessionId;
    this.simulatedLagMs = Math.max(0, simulatedLagMs);
    this.callbacks = callbacks;

    this.bindRoomHandlers(room);
  }

  private rebuildLocalVisionObstacles(): void {
    this.visionObstacles = buildObstaclesFromProps(
      this.props,
      [],
      [],
      Array.from(this.authoritativeLootContainers.values()),
      Array.from(this.authoritativeStructures.values())
    );
  }

  static getWebSocketEndpoint(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  static async createPrivateRoom(
    simulatedLagMs = 0,
    callbacks: OnlineProviderCallbacks = {},
    roomOptions: CreateRoomClientOptions = {}
  ): Promise<OnlineProvider> {
    const client = new Client(OnlineProvider.getWebSocketEndpoint());
    const room = await client.create<RemoteRoomStateView>('survival', {
      protocolVersion: BALANCE.PROTOCOL_VERSION,
      gameMode: roomOptions.gameMode ?? 'rounds',
      seed: roomOptions.seed,
    });
    return new OnlineProvider(client, room, simulatedLagMs, callbacks);
  }

  static async joinPrivateRoomByCode(
    rawCode: string,
    simulatedLagMs = 0,
    callbacks: OnlineProviderCallbacks = {},
    overrideProtocolVersion?: number
  ): Promise<OnlineProvider> {
    const code = rawCode.trim().toUpperCase();
    const protocolVersion = overrideProtocolVersion ?? BALANCE.PROTOCOL_VERSION;

    const response = await fetch(
      `/api/rooms/${encodeURIComponent(code)}?protocolVersion=${encodeURIComponent(
        String(protocolVersion)
      )}`
    );
    const data = (await response.json()) as {
      ok: boolean;
      errorCode?: string;
      message?: string;
      room?: { colyseusRoomId: string; roomCode: string };
    };

    if (!response.ok || !data.ok || !data.room) {
      const err = new Error(data.message ?? 'Não foi possível entrar na sala.');
      (err as Error & { code?: string }).code = data.errorCode ?? 'ROOM_NOT_FOUND';
      throw err;
    }

    const client = new Client(OnlineProvider.getWebSocketEndpoint());
    const room = await client.joinById<RemoteRoomStateView>(data.room.colyseusRoomId, {
      protocolVersion,
    });
    return new OnlineProvider(client, room, simulatedLagMs, callbacks);
  }

  setReady(ready?: boolean): void {
    const payload = ready !== undefined ? { ready } : {};
    this.sendWithOptionalLag('ready', payload);
  }

  skipRoundIntermission(): void {
    this.sendWithOptionalLag('skip_intermission', {});
  }

  restart(): void {
    this.sendWithOptionalLag('play_again', {});
  }

  chooseUpgrade(upgradeId: string): void {
    this.sendWithOptionalLag('choose_upgrade', { upgradeId });
  }

  switchWeaponSlot(slot: EquippedSlotId): void {
    this.sendWithOptionalLag('switch_slot', { slot });
  }

  reloadWeapon(): void {
    this.sendWithOptionalLag('reload_weapon', {});
  }

  interactLoot(): void {
    this.sendWithOptionalLag('interact_loot', {});
  }

  buildStructure(kind: StructureKind): void {
    this.sendWithOptionalLag('build_structure', { kind });
  }

  repairStructure(): void {
    this.sendWithOptionalLag('repair_structure', {});
  }

  useMedkit(): void {
    this.sendWithOptionalLag('use_medkit', {});
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    if (this.pingTimerId !== null) {
      window.clearInterval(this.pingTimerId);
      this.pingTimerId = null;
    }
    try {
      await this.room.leave(true);
    } catch {
      // Ignora erro ao fechar socket já encerrado
    }
  }

  /**
   * Simula queda abrupta de transporte WebSocket (não consensual) para testar a janela de 20s de reconexão.
   */
  simulateTransportDropForTest(): void {
    const rawConn = (this.room as unknown as { connection?: { close?: () => void } }).connection;
    rawConn?.close?.();
  }

  updateFrame(frameDtMs: number, rawInput: Vec2, aimInput?: FrameAimInput): void {
    const clampedDtMs = Math.min(Math.max(0, frameDtMs), 200);
    this.updateTelemetryWindow();

    if (this.hasServerTimeEstimate && this.phase === 'playing' && !this.gameOver) {
      this.estimatedServerTimeMs += clampedDtMs;
    }

    if (this.phase !== 'playing' || this.gameOver) {
      return;
    }

    const tickMs = BALANCE.SIMULATION.TICK_DT_MS;
    this.localAccumulatorMs += clampedDtMs;
    const normInput = normalizeInputVector(rawInput.x, rawInput.y);
    const normAim = aimInput
      ? normalizeInputVector(aimInput.aimX, aimInput.aimY)
      : { x: 0, y: 0 };

    let consumedOneShotActions = false;

    while (this.localAccumulatorMs >= tickMs) {
      this.localAccumulatorMs -= tickMs;

      const seq = this.nextSeq++;
      const cmd: InputCmd = {
        seq,
        dx: normInput.x,
        dy: normInput.y,
        aimMode: aimInput?.aimMode ?? 'auto',
        aimX: normAim.x,
        aimY: normAim.y,
        firing: Boolean(aimInput?.firing),
        switchSlot: !consumedOneShotActions ? aimInput?.switchSlot : undefined,
        reload: !consumedOneShotActions ? aimInput?.reload : undefined,
        interact: !consumedOneShotActions ? aimInput?.interact : undefined,
        buildStructure: !consumedOneShotActions ? aimInput?.buildStructure : undefined,
        repairStructure: !consumedOneShotActions ? aimInput?.repairStructure : undefined,
        useMedkit: !consumedOneShotActions ? aimInput?.useMedkit : undefined,
      };
      consumedOneShotActions = true;

      this.pendingInputs.push(cmd);
      if (this.pendingInputs.length > BALANCE.SIMULATION.MAX_PENDING_INPUTS) {
        this.pendingInputs.shift();
      }

      this.sendWithOptionalLag('input', cmd);

      // Passo de predição imediata do jogador local
      if (this.currPredictedLocal && this.currPredictedLocal.alive) {
        this.prevPredictedLocal = { ...this.currPredictedLocal };
        const stepped = stepEntityMovement(
          this.currPredictedLocal.x,
          this.currPredictedLocal.y,
          cmd.dx,
          cmd.dy,
          BALANCE.PLAYER.SPEED_PX_PER_SEC,
          BALANCE.SIMULATION.TICK_DT_SEC,
          this.currPredictedLocal.radius,
          this.mapWidth,
          this.mapHeight,
          this.visionObstacles
        );
        this.currPredictedLocal.x = stepped.x;
        this.currPredictedLocal.y = stepped.y;
        this.currPredictedLocal.vx = stepped.vx;
        this.currPredictedLocal.vy = stepped.vy;
        this.currPredictedLocal.aimMode = cmd.aimMode;
        if (
          cmd.aimX !== undefined &&
          cmd.aimY !== undefined &&
          (cmd.aimX !== 0 || cmd.aimY !== 0)
        ) {
          this.currPredictedLocal.facingAngle = Math.atan2(cmd.aimY, cmd.aimX);
        } else if (stepped.vx !== 0 || stepped.vy !== 0) {
          this.currPredictedLocal.facingAngle = Math.atan2(stepped.vy, stepped.vx);
        }
      }
    }
  }

  getRenderState(): RenderWorldState {
    const tickMs = BALANCE.SIMULATION.TICK_DT_MS;
    const localAlpha =
      this.phase === 'playing' && !this.gameOver
        ? Math.min(1, Math.max(0, this.localAccumulatorMs / tickMs))
        : 1;

    // 1. Interpola entidades remotas (outro jogador e zumbis) com atraso de 100 ms
    const renderServerTimeMs =
      this.estimatedServerTimeMs - BALANCE.SIMULATION.INTERP_DELAY_MS;
    const interpolatedRemote = interpolateRemoteEntities(
      this.snapshotBuffer,
      renderServerTimeMs,
      this.localPlayerId
    );

    // 2. Combina jogador local predito/reconciliado + jogadores remotos interpolados
    const players: PlayerStateSnapshot[] = [];
    if (this.currPredictedLocal) {
      const prev = this.prevPredictedLocal ?? this.currPredictedLocal;
      players.push({
        ...this.currPredictedLocal,
        x: prev.x + (this.currPredictedLocal.x - prev.x) * localAlpha,
        y: prev.y + (this.currPredictedLocal.y - prev.y) * localAlpha,
      });
    }
    for (const remoteP of interpolatedRemote.remotePlayers) {
      players.push(remoteP);
    }

    return {
      gameMode: this.gameMode,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      seed: this.seed,
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      roomCode: this.roomCode,
      phase: this.phase,
      countdownMs: this.countdownMs,
      gameOver: this.gameOver,
      kills: this.kills,
      totalDamageDealt: this.totalDamageDealt,
      totalRevives: this.totalRevives,
      structuresBuilt: this.structuresBuilt,
      xp: this.xp,
      level: this.level,
      xpToNextLevel: this.xpToNextLevel,
      weaponDamage: this.weaponDamage,
      weaponFireRate: this.weaponFireRate,
      lastLevelBonusLabel: this.lastLevelBonusLabel,
      localPlayerId: this.localPlayerId,
      players,
      zombies: interpolatedRemote.zombies,
      props: this.props,
      lootItems: Array.from(this.authoritativeLootItems.values()),
      lootContainers: Array.from(this.authoritativeLootContainers.values()),
      structures: Array.from(this.authoritativeStructures.values()),
      roundsState: this.gameMode === 'rounds' ? { ...this.roundsState } : undefined,
      explorationState:
        this.gameMode === 'exploration' ? { ...this.explorationState } : undefined,
      interpolationAlpha: localAlpha,
      telemetry: {
        pingMs: this.pingMs,
        rxBytesPerSec: this.rxBytesPerSec,
        txBytesPerSec: this.txBytesPerSec,
        pendingInputsCount: this.pendingInputs.length,
        simulatedLagMs: this.simulatedLagMs,
      },
    };
  }

  consumeNewEvents(): GameEvent[] {
    if (this.pendingEvents.length === 0) {
      return [];
    }
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  private bindRoomHandlers(room: Room<RemoteRoomStateView>): void {
    this.localPlayerId = room.sessionId;
    this.lastReconnectionToken = room.reconnectionToken;

    // Padronizado conforme exigência 1: uso exclusivo de getStateCallbacks(room) da linha Colyseus 0.16
    const $ = getStateCallbacks(room);

    $(room.state).onChange(() => {
      const snapshotPayload = {
        roomCode: room.state.roomCode,
        gameMode: room.state.gameMode,
        phase: room.state.phase,
        countdownMs: room.state.countdownMs,
        tick: room.state.tick,
        elapsedMs: room.state.elapsedMs,
        seed: room.state.seed,
        mapWidth: room.state.mapWidth,
        mapHeight: room.state.mapHeight,
        gameOver: room.state.gameOver,
        kills: room.state.kills,
        totalDamageDealt: room.state.totalDamageDealt,
        totalRevives: room.state.totalRevives,
        structuresBuilt: room.state.structuresBuilt,
        xp: room.state.xp,
        level: room.state.level,
        xpToNextLevel: room.state.xpToNextLevel,
        weaponDamage: room.state.weaponDamage,
        weaponFireRate: room.state.weaponFireRate,
        lastLevelBonusLabel: room.state.lastLevelBonusLabel,
        roundNumber: room.state.roundNumber,
        roundPhase: room.state.roundPhase,
        isSpecialEliteRound: room.state.isSpecialEliteRound,
        roundTotalZombies: room.state.roundTotalZombies,
        roundRemainingZombies: room.state.roundRemainingZombies,
        intermissionRemainingMs: room.state.intermissionRemainingMs,
        roundsCompleted: room.state.roundsCompleted,
        explorationPhase: room.state.explorationPhase,
        daysSurvived: room.state.daysSurvived,
        hordeNumber: room.state.hordeNumber,
        hordesCleared: room.state.hordesCleared,
        timeUntilNextHordeMs: room.state.timeUntilNextHordeMs,
        warningRemainingMs: room.state.warningRemainingMs,
        recoveryRemainingMs: room.state.recoveryRemainingMs,
        hordeTotalZombies: room.state.hordeTotalZombies,
        hordeRemainingZombies: room.state.hordeRemainingZombies,
        sectorsExplored: room.state.sectorsExplored,
      };
      // Contabiliza bytes aproximados do patch de estado
      this.rxBytesWindow +=
        48 + this.authoritativePlayers.size * 26 + this.authoritativeZombies.size * 20;
      this.runWithOptionalInboundLag(() => {
        this.applyRoomScalarState(snapshotPayload);
      });
    });

    $(room.state).players.onAdd((player, sessionId) => {
      const syncPlayer = () => {
        const snap = this.extractPlayerSnapshot(player, sessionId);
        this.runWithOptionalInboundLag(() => {
          this.onAuthoritativePlayerUpdated(snap);
        });
      };
      syncPlayer();
      $(player).onChange(() => {
        syncPlayer();
      });
    });

    $(room.state).players.onRemove((_player, sessionId) => {
      this.runWithOptionalInboundLag(() => {
        this.authoritativePlayers.delete(sessionId);
        if (sessionId === this.localPlayerId) {
          this.currPredictedLocal = null;
          this.prevPredictedLocal = null;
        }
        this.recordSnapshotBufferEntry();
      });
    });

    $(room.state).zombies.onAdd((zombie) => {
      const syncZombie = () => {
        const zSnap = this.extractZombieSnapshot(zombie);
        this.runWithOptionalInboundLag(() => {
          this.authoritativeZombies.set(zSnap.id, zSnap);
          this.recordSnapshotBufferEntry();
        });
      };
      syncZombie();
      $(zombie).onChange(() => {
        syncZombie();
      });
    });

    $(room.state).zombies.onRemove((zombie) => {
      const zId = zombie.id;
      this.runWithOptionalInboundLag(() => {
        this.authoritativeZombies.delete(zId);
        this.recordSnapshotBufferEntry();
      });
    });

    if (room.state.lootItems) {
      $(room.state).lootItems.onAdd((item) => {
        const syncLoot = () => {
          const snap = this.extractLootItemSnapshot(item);
          this.runWithOptionalInboundLag(() => {
            this.authoritativeLootItems.set(snap.id, snap);
          });
        };
        syncLoot();
        $(item).onChange(() => {
          syncLoot();
        });
      });

      $(room.state).lootItems.onRemove((item) => {
        const lId = item.id;
        this.runWithOptionalInboundLag(() => {
          this.authoritativeLootItems.delete(lId);
        });
      });
    }

    if (room.state.lootContainers) {
      $(room.state).lootContainers.onAdd((container) => {
        const syncContainer = () => {
          const snap = this.extractLootContainerSnapshot(container);
          this.runWithOptionalInboundLag(() => {
            this.authoritativeLootContainers.set(snap.id, snap);
            this.rebuildLocalVisionObstacles();
          });
        };
        syncContainer();
        $(container).onChange(() => {
          syncContainer();
        });
      });

      $(room.state).lootContainers.onRemove((container) => {
        const cId = container.id;
        this.runWithOptionalInboundLag(() => {
          this.authoritativeLootContainers.delete(cId);
          this.rebuildLocalVisionObstacles();
        });
      });
    }

    if (room.state.structures) {
      $(room.state).structures.onAdd((structure) => {
        const syncStructure = () => {
          const snap = this.extractStructureSnapshot(structure);
          this.runWithOptionalInboundLag(() => {
            this.authoritativeStructures.set(snap.id, snap);
            this.rebuildLocalVisionObstacles();
          });
        };
        syncStructure();
        $(structure).onChange(() => {
          syncStructure();
        });
      });

      $(room.state).structures.onRemove((structure) => {
        const sId = structure.id;
        this.runWithOptionalInboundLag(() => {
          this.authoritativeStructures.delete(sId);
          this.rebuildLocalVisionObstacles();
        });
      });
    }

    room.onMessage('events', (events: GameEvent[]) => {
      if (!Array.isArray(events)) {
        return;
      }
      this.rxBytesWindow += events.length * 28;
      this.runWithOptionalInboundLag(() => {
        for (const ev of events) {
          if (ev.eventId > this.lastConsumedEventId) {
            this.lastConsumedEventId = ev.eventId;
            this.pendingEvents.push(ev);
          }
        }
      });
    });

    room.onMessage(
      'pong',
      (payload: { clientSentAt: number; serverTick: number; serverElapsedMs: number }) => {
        this.rxBytesWindow += 20;
        const rtt = Math.max(0, Math.round(Date.now() - payload.clientSentAt));
        this.pingMs = rtt + this.simulatedLagMs;
      }
    );

    room.onLeave((code) => {
      if (this.manualDisconnect) {
        return;
      }
      // Código 1000 = fechamento normal; quedas inesperadas tentam reconectar dentro da janela de 20s
      if (code !== 1000 && this.lastReconnectionToken && !this.reconnecting) {
        void this.tryAutoReconnect();
      } else if (!this.reconnecting) {
        this.callbacks.onConnectionLost?.('Conexão com a sala encerrada.');
      }
    });

    if (this.pingTimerId !== null) {
      window.clearInterval(this.pingTimerId);
    }
    this.pingTimerId = window.setInterval(() => {
      this.sendWithOptionalLag('ping', { clientSentAt: Date.now() });
    }, 1000);
  }

  private async tryAutoReconnect(): Promise<void> {
    if (!this.lastReconnectionToken || this.reconnecting) {
      return;
    }
    this.reconnecting = true;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await new Promise((r) => setTimeout(r, 600));
        const reconnectedRoom = await this.client.reconnect<RemoteRoomStateView>(
          this.lastReconnectionToken
        );
        this.room = reconnectedRoom;
        this.reconnecting = false;
        this.bindRoomHandlers(reconnectedRoom);
        return;
      } catch {
        // Continua tentando dentro da janela
      }
    }

    this.reconnecting = false;
    this.callbacks.onConnectionLost?.(
      'Queda de conexão: não foi possível reconectar à sala.'
    );
  }

  private applyRoomScalarState(s: {
    roomCode: string;
    gameMode: GameMode;
    phase: RoomPhase;
    countdownMs: number;
    tick: number;
    elapsedMs: number;
    seed: number;
    mapWidth: number;
    mapHeight: number;
    gameOver: boolean;
    kills: number;
    totalDamageDealt: number;
    totalRevives: number;
    structuresBuilt: number;
    xp: number;
    level: number;
    xpToNextLevel: number;
    weaponDamage: number;
    weaponFireRate: number;
    lastLevelBonusLabel: string;
    roundNumber: number;
    roundPhase: RoundSubPhase;
    isSpecialEliteRound: boolean;
    roundTotalZombies: number;
    roundRemainingZombies: number;
    intermissionRemainingMs: number;
    roundsCompleted: number;
    explorationPhase: ExplorationSubPhase;
    daysSurvived: number;
    hordeNumber: number;
    hordesCleared: number;
    timeUntilNextHordeMs: number;
    warningRemainingMs: number;
    recoveryRemainingMs: number;
    hordeTotalZombies: number;
    hordeRemainingZombies: number;
    sectorsExplored: number;
  }): void {
    const prevPhase = this.phase;
    const prevSeed = this.seed;

    this.roomCode = s.roomCode || this.roomCode;
    this.gameMode = s.gameMode === 'exploration' ? 'exploration' : 'rounds';
    this.phase = s.phase || this.phase;
    this.countdownMs = s.countdownMs;
    this.tick = s.tick;
    this.elapsedMs = s.elapsedMs;
    this.mapWidth = s.mapWidth || BALANCE.MAP.WIDTH;
    this.mapHeight = s.mapHeight || BALANCE.MAP.HEIGHT;
    this.gameOver = s.gameOver;
    this.kills = s.kills;
    this.totalDamageDealt = s.totalDamageDealt ?? 0;
    this.totalRevives = s.totalRevives ?? 0;
    this.structuresBuilt = s.structuresBuilt ?? 0;
    this.xp = s.xp;
    this.level = s.level;
    this.xpToNextLevel = s.xpToNextLevel;
    this.weaponDamage = s.weaponDamage || BALANCE.PISTOL.DAMAGE;
    this.weaponFireRate = s.weaponFireRate || BALANCE.PISTOL.FIRE_RATE_PER_SEC;
    this.lastLevelBonusLabel = s.lastLevelBonusLabel ?? '';

    const livingConnected = Array.from(this.authoritativePlayers.values()).filter(
      (p) => p.alive && p.connected
    );
    const readyCount = livingConnected.filter((p) => p.readyForNextRound).length;

    this.roundsState = {
      roundNumber: s.roundNumber || 1,
      roundPhase: s.roundPhase === 'intermission' ? 'intermission' : 'active',
      isSpecialEliteRound: Boolean(s.isSpecialEliteRound),
      roundTotalZombies: s.roundTotalZombies ?? 0,
      roundSpawnedZombies:
        (s.roundTotalZombies ?? 0) - (s.roundRemainingZombies ?? 0),
      roundRemainingZombies: s.roundRemainingZombies ?? 0,
      intermissionRemainingMs: s.intermissionRemainingMs ?? 0,
      roundsCompleted: s.roundsCompleted ?? 0,
      threatBudget: BALANCE.ROUNDS.BASE_THREAT_BUDGET,
      readyPlayersCount: readyCount,
      livingPlayersCount: Math.max(1, livingConnected.length),
    };

    this.explorationState = {
      explorationPhase:
        s.explorationPhase === 'horde_warning' ||
        s.explorationPhase === 'horde_active' ||
        s.explorationPhase === 'recovery'
          ? s.explorationPhase
          : 'exploring',
      daysSurvived: s.daysSurvived || 1,
      dayProgressRatio:
        (this.elapsedMs % BALANCE.EXPLORATION.DAY_DURATION_MS) /
        BALANCE.EXPLORATION.DAY_DURATION_MS,
      hordeNumber: s.hordeNumber ?? 0,
      hordesCleared: s.hordesCleared ?? 0,
      timeUntilNextHordeMs: s.timeUntilNextHordeMs ?? 0,
      warningRemainingMs: s.warningRemainingMs ?? 0,
      recoveryRemainingMs: s.recoveryRemainingMs ?? 0,
      hordeTotalZombies: s.hordeTotalZombies ?? 0,
      hordeSpawnedZombies:
        (s.hordeTotalZombies ?? 0) - (s.hordeRemainingZombies ?? 0),
      hordeRemainingZombies: s.hordeRemainingZombies ?? 0,
      ambientZombiesAlive: this.authoritativeZombies.size,
      sectorsExplored: s.sectorsExplored ?? 1,
      totalSectors: 64,
    };

    if (s.seed && s.seed !== prevSeed) {
      this.seed = s.seed;
      this.props = generateMapProps(s.seed);
      this.rebuildLocalVisionObstacles();
    }

    const serverClockMs = s.tick * BALANCE.SIMULATION.TICK_DT_MS;
    if (!this.hasServerTimeEstimate || Math.abs(serverClockMs - this.estimatedServerTimeMs) > 150) {
      this.estimatedServerTimeMs = serverClockMs;
      this.hasServerTimeEstimate = true;
    } else {
      // Corrige deriva de relógio suavemente
      this.estimatedServerTimeMs += (serverClockMs - this.estimatedServerTimeMs) * 0.2;
    }

    this.recordSnapshotBufferEntry();

    if (prevPhase !== this.phase) {
      this.callbacks.onPhaseChange?.(this.phase, this.roomCode);
    }
  }

  private onAuthoritativePlayerUpdated(snap: PlayerStateSnapshot): void {
    this.authoritativePlayers.set(snap.id, snap);

    if (snap.id === this.localPlayerId) {
      // Reconcilia predição local com o estado confirmado pelo servidor usando `lastProcessedSeq`
      const { reconciledPlayer, remainingInputs } = reconcileLocalPlayer(
        snap,
        this.pendingInputs,
        this.mapWidth,
        this.mapHeight,
        this.visionObstacles
      );
      this.pendingInputs = remainingInputs;

      if (!this.currPredictedLocal) {
        this.prevPredictedLocal = { ...reconciledPlayer };
        this.currPredictedLocal = { ...reconciledPlayer };
      } else {
        this.prevPredictedLocal = { ...this.currPredictedLocal };
        this.currPredictedLocal = { ...reconciledPlayer };
      }
    }

    this.recordSnapshotBufferEntry();
  }

  private recordSnapshotBufferEntry(): void {
    const serverTimeMs = this.tick * BALANCE.SIMULATION.TICK_DT_MS;
    const playersCopy = new Map<string, PlayerStateSnapshot>();
    for (const [id, p] of this.authoritativePlayers.entries()) {
      playersCopy.set(id, { ...p });
    }
    const zombiesCopy = new Map<number, ZombieStateSnapshot>();
    for (const [id, z] of this.authoritativeZombies.entries()) {
      zombiesCopy.set(id, { ...z });
    }

    const last = this.snapshotBuffer[this.snapshotBuffer.length - 1];
    if (last && last.serverTimeMs === serverTimeMs) {
      last.players = playersCopy;
      last.zombies = zombiesCopy;
      return;
    }

    this.snapshotBuffer.push({
      serverTimeMs,
      players: playersCopy,
      zombies: zombiesCopy,
    });

    while (this.snapshotBuffer.length > BALANCE.NETWORK.SNAPSHOT_BUFFER_SIZE) {
      this.snapshotBuffer.shift();
    }
  }

  private extractPlayerSnapshot(
    p: RemotePlayerSchemaView,
    sessionId: string
  ): PlayerStateSnapshot {
    const activeSlot: EquippedSlotId =
      p.activeSlot === 'slot1' || p.activeSlot === 'slot2' ? p.activeSlot : 'knife';
    const activeWeaponId: WeaponId =
      p.activeWeaponId === 'bat' ||
      p.activeWeaponId === 'pistol' ||
      p.activeWeaponId === 'shotgun' ||
      p.activeWeaponId === 'smg' ||
      p.activeWeaponId === 'rifle'
        ? p.activeWeaponId
        : 'knife';
    const parseSlotWeapon = (val?: string): WeaponId | '' =>
      val === 'bat' ||
      val === 'pistol' ||
      val === 'shotgun' ||
      val === 'smg' ||
      val === 'rifle' ||
      val === 'knife'
        ? val
        : '';
    const meleePhase: MeleeAttackPhase =
      p.meleePhase === 'windup' ||
      p.meleePhase === 'active' ||
      p.meleePhase === 'recovery'
        ? p.meleePhase
        : 'idle';

    return {
      id: p.id || sessionId,
      colorIndex: p.colorIndex ?? 0,
      x: p.x ?? BALANCE.PLAYER.SPAWN_X,
      y: p.y ?? BALANCE.PLAYER.SPAWN_Y,
      vx: p.vx ?? 0,
      vy: p.vy ?? 0,
      facingAngle: p.facingAngle ?? 0,
      radius: p.radius ?? BALANCE.PLAYER.RADIUS,
      hp: p.hp ?? BALANCE.PLAYER.MAX_HP,
      maxHp: p.maxHp ?? BALANCE.PLAYER.MAX_HP,
      alive: p.alive ?? true,
      connected: p.connected ?? true,
      ready: p.ready ?? false,
      aimMode: p.aimMode === 'manual' ? 'manual' : 'auto',
      invulnMs: p.invulnMs ?? 0,
      fireCooldownMs: 0,
      kills: p.kills ?? 0,
      lastProcessedSeq: p.lastProcessedSeq ?? 0,
      reviveProgress: p.reviveProgress ?? 0,
      pendingUpgradeOptions: p.pendingUpgradesCsv
        ? p.pendingUpgradesCsv.split(',').filter(Boolean)
        : [],
      pendingUpgradeTimerMs: p.pendingUpgradeTimerMs ?? 0,
      upgradesChosenCount: p.upgradesChosenCount ?? 0,
      readyForNextRound: Boolean(p.readyForNextRound),
      damageDealt: p.damageDealt ?? 0,
      revivesCount: p.revivesCount ?? 0,
      activeSlot,
      activeWeaponId,
      slot1WeaponId: parseSlotWeapon(p.slot1WeaponId),
      slot2WeaponId: parseSlotWeapon(p.slot2WeaponId),
      slot1MagAmmo: p.slot1MagAmmo ?? 0,
      slot2MagAmmo: p.slot2MagAmmo ?? 0,
      ammoLight: p.ammoLight ?? 0,
      ammoShells: p.ammoShells ?? 0,
      ammoHeavy: p.ammoHeavy ?? 0,
      reloadRemainingMs: p.reloadRemainingMs ?? 0,
      reloadTotalMs: p.reloadTotalMs ?? 0,
      meleePhase,
      wood: p.wood ?? BALANCE.SURVIVAL.STARTING_WOOD,
      scrap: p.scrap ?? BALANCE.SURVIVAL.STARTING_SCRAP,
      medkits: p.medkits ?? BALANCE.SURVIVAL.STARTING_MEDKITS,
    };
  }

  private extractZombieSnapshot(z: RemoteZombieSchemaView): ZombieStateSnapshot {
    const kind: ZombieKind =
      z.kind === 'fast' || z.kind === 'brute' ? z.kind : 'common';
    return {
      id: z.id,
      kind,
      x: z.x,
      y: z.y,
      vx: z.vx,
      vy: z.vy,
      facingAngle: z.facingAngle,
      radius: z.radius,
      hp: z.hp,
      maxHp: z.maxHp,
      isElite: Boolean(z.isElite),
    };
  }

  private extractLootItemSnapshot(
    item: RemoteLootItemSchemaView
  ): WorldLootItemSnapshot {
    const kind = item.kind === 'ammo' ? 'ammo' : 'weapon';
    const weaponId: WeaponId | undefined =
      item.weaponId === 'bat' ||
      item.weaponId === 'pistol' ||
      item.weaponId === 'shotgun' ||
      item.weaponId === 'smg' ||
      item.weaponId === 'rifle' ||
      item.weaponId === 'knife'
        ? item.weaponId
        : undefined;
    const ammoType: Exclude<AmmoType, 'none'> | undefined =
      item.ammoType === 'light' ||
      item.ammoType === 'shells' ||
      item.ammoType === 'heavy'
        ? item.ammoType
        : undefined;

    return {
      id: item.id,
      kind,
      x: item.x,
      y: item.y,
      weaponId,
      magAmmo: item.magAmmo || undefined,
      ammoType,
      ammoAmount: item.ammoAmount || undefined,
      label: item.label || '',
    };
  }

  private extractLootContainerSnapshot(
    c: RemoteLootContainerSchemaView
  ): LootContainerSnapshot {
    const kind: LootContainerKind =
      c.kind === 'weapon_case' || c.kind === 'ammo_box' ? c.kind : 'supply_crate';
    return {
      id: c.id,
      kind,
      x: c.x,
      y: c.y,
      opened: Boolean(c.opened),
      label: c.label || 'Recipiente',
    };
  }

  private extractStructureSnapshot(
    s: RemoteStructureSchemaView
  ): BuildableStructureSnapshot {
    const kind: StructureKind =
      s.kind === 'scrap_barricade' || s.kind === 'spike_trap'
        ? s.kind
        : 'wood_barricade';
    return {
      id: s.id,
      kind,
      x: s.x,
      y: s.y,
      rotation: 0,
      radius: s.radius || 20,
      hp: s.hp,
      maxHp: s.maxHp || 180,
      ownerId: s.ownerId || '',
      label: s.label || 'Estrutura',
    };
  }

  private sendWithOptionalLag(type: string, payload: unknown): void {
    const serializedLen = JSON.stringify(payload ?? {}).length + type.length + 4;
    this.txBytesWindow += serializedLen;

    const halfLag = Math.round(this.simulatedLagMs * 0.5);
    if (halfLag > 0) {
      window.setTimeout(() => {
        if (!this.manualDisconnect) {
          this.room.send(type, payload);
        }
      }, halfLag);
    } else {
      this.room.send(type, payload);
    }
  }

  private runWithOptionalInboundLag(fn: () => void): void {
    const halfLag = Math.round(this.simulatedLagMs * 0.5);
    if (halfLag > 0) {
      window.setTimeout(fn, halfLag);
    } else {
      fn();
    }
  }

  private updateTelemetryWindow(): void {
    const now = performance.now();
    const elapsedSec = (now - this.telemetryWindowStartMs) / 1000;
    if (elapsedSec >= 1) {
      this.rxBytesPerSec = Math.round(this.rxBytesWindow / elapsedSec);
      this.txBytesPerSec = Math.round(this.txBytesWindow / elapsedSec);
      this.rxBytesWindow = 0;
      this.txBytesWindow = 0;
      this.telemetryWindowStartMs = now;
    }
  }
}
