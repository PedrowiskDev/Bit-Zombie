import {
  BALANCE,
  Simulation,
  normalizeInputVector,
  type AmmoType,
  type EquippedSlotId,
  type GameEvent,
  type GameMode,
  type PlayerStateSnapshot,
  type ResourceKind,
  type StructureKind,
  type Vec2,
  type WeaponId,
  type WorldSnapshot,
  type ZombieStateSnapshot,
} from '@zombie-coop/shared';
import type {
  FrameAimInput,
  IWorldProvider,
  RenderWorldState,
} from './WorldProvider.js';

/**
 * Provider offline para modo solo.
 * - Roda a `Simulation` de `@zombie-coop/shared` em passo fixo de 50 ms (20 Hz).
 * - Desacopla a frequência da simulação (20 Hz) da frequência de renderização (60+ Hz),
 *   interpolando visualmente jogadores e zumbis entre `prevSnapshot` e `currSnapshot`.
 * - Aplica a regra de consumo único de eventos via `lastConsumedEventId`.
 */
export class OfflineProvider implements IWorldProvider {
  public readonly mode = 'offline' as const;
  public readonly localPlayerId: string;

  private sim!: Simulation;
  private currentSeed: number;
  private currentGameMode: GameMode;
  private accumulatorMs = 0;
  private nextSeq = 1;
  private prevSnapshot!: WorldSnapshot;
  private currSnapshot!: WorldSnapshot;
  private pendingClientEvents: GameEvent[] = [];
  private lastConsumedEventId = 0;

  constructor(
    localPlayerId = 'player-1',
    seed: number = BALANCE.SIMULATION.DEFAULT_SEED,
    gameMode: GameMode = 'rounds'
  ) {
    this.localPlayerId = localPlayerId;
    this.currentSeed = seed;
    this.currentGameMode = gameMode;
    this.initSimulation(seed, gameMode);
  }

  restart(newSeed?: number): void {
    this.currentSeed = newSeed ?? ((this.currentSeed + 104729) >>> 0);
    this.initSimulation(this.currentSeed, this.currentGameMode);
  }

  /** Método auxiliar para testes automatizados de tela de Game Over */
  forceLocalPlayerDefeatForTest(): void {
    this.sim.setPlayerHp(this.localPlayerId, 0);
    this.currSnapshot = this.sim.getSnapshot();
    this.prevSnapshot = this.currSnapshot;
  }

  /** Método auxiliar para testes automatizados de progressão de XP e nível */
  awardXpForTest(amount: number): void {
    this.sim.addSharedXp(amount);
    this.currSnapshot = this.sim.getSnapshot();
    this.prevSnapshot = this.currSnapshot;
    this.collectSimulationEvents();
  }

  /** Solicita antecipar a próxima rodada durante o intervalo de 25s no Modo 1 */
  skipRoundIntermission(): void {
    if (this.sim.requestSkipRoundIntermission(this.localPlayerId)) {
      this.currSnapshot = this.sim.getSnapshot();
      this.prevSnapshot = this.currSnapshot;
      this.collectSimulationEvents();
    }
  }

  /** Escolhe uma carta de upgrade pendente na Fase 2 */
  chooseUpgrade(upgradeId: string): void {
    if (this.sim.chooseUpgrade(this.localPlayerId, upgradeId, false)) {
      this.currSnapshot = this.sim.getSnapshot();
      this.prevSnapshot = this.currSnapshot;
      this.collectSimulationEvents();
    }
  }

  /** Troca o slot de arma ativo (Etapa 3) */
  switchWeaponSlot(slot: EquippedSlotId): void {
    if (this.sim.switchPlayerSlot(this.localPlayerId, slot)) {
      this.currSnapshot = this.sim.getSnapshot();
      this.prevSnapshot = this.currSnapshot;
    }
  }

  /** Inicia recarga da arma de fogo ativa (Etapa 3) */
  reloadWeapon(): void {
    if (this.sim.reloadPlayerWeapon(this.localPlayerId)) {
      this.currSnapshot = this.sim.getSnapshot();
      this.prevSnapshot = this.currSnapshot;
    }
  }

  /** Interage com recipiente ou loot no chão (Etapa 3) */
  interactLoot(): void {
    if (this.sim.interactPlayerLoot(this.localPlayerId)) {
      this.currSnapshot = this.sim.getSnapshot();
      this.prevSnapshot = this.currSnapshot;
      this.collectSimulationEvents();
    }
  }

  /** Constrói fortificação ou armadilha à frente do jogador local (Etapa 4) */
  buildStructure(kind: StructureKind): void {
    if (this.sim.buildPlayerStructure(this.localPlayerId, kind)) {
      this.currSnapshot = this.sim.getSnapshot();
      this.prevSnapshot = this.currSnapshot;
      this.collectSimulationEvents();
    }
  }

  /** Repara a fortificação danificada mais próxima gastando 1 Madeira (Etapa 4) */
  repairStructure(): void {
    if (this.sim.repairNearestStructure(this.localPlayerId)) {
      this.currSnapshot = this.sim.getSnapshot();
      this.prevSnapshot = this.currSnapshot;
      this.collectSimulationEvents();
    }
  }

  /** Usa 1 Kit Médico para restaurar HP do jogador local (Etapa 4) */
  useMedkit(): void {
    if (this.sim.usePlayerMedkit(this.localPlayerId)) {
      this.currSnapshot = this.sim.getSnapshot();
      this.prevSnapshot = this.currSnapshot;
      this.collectSimulationEvents();
    }
  }

  /** Método auxiliar para adicionar recursos em testes da Etapa 4 */
  addResourceForTest(kind: ResourceKind, amount: number): void {
    this.sim.addResource(this.localPlayerId, kind, amount);
    this.currSnapshot = this.sim.getSnapshot();
    this.prevSnapshot = this.currSnapshot;
  }

  /** Método auxiliar para conceder uma arma diretamente em testes da Etapa 3 */
  giveWeaponForTest(weaponId: WeaponId): boolean {
    const ok = this.sim.giveWeapon(this.localPlayerId, weaponId);
    this.currSnapshot = this.sim.getSnapshot();
    this.prevSnapshot = this.currSnapshot;
    return ok;
  }

  /** Método auxiliar para spawnar loot no chão em testes da Etapa 3 */
  spawnLootForTest(options: {
    x: number;
    y: number;
    kind: 'weapon' | 'ammo';
    weaponId?: WeaponId;
    ammoType?: Exclude<AmmoType, 'none'>;
    ammoAmount?: number;
    label?: string;
  }): number {
    const item = this.sim.spawnLootItem({
      ...options,
      label: options.label ?? options.weaponId ?? options.ammoType ?? 'Loot',
    });
    this.currSnapshot = this.sim.getSnapshot();
    this.prevSnapshot = this.currSnapshot;
    return item.id;
  }

  /** Método auxiliar para testar resgate cooperativo de aliado caído (Fase 2) */
  spawnDownedAllyForTest(x?: number, y?: number): void {
    const local = this.currSnapshot.players.find((p) => p.id === this.localPlayerId);
    const spawnX = x ?? (local ? local.x + 28 : BALANCE.PLAYER.SPAWN_X + 28);
    const spawnY = y ?? (local ? local.y : BALANCE.PLAYER.SPAWN_Y);
    this.sim.addPlayer('ally-bot', { x: spawnX, y: spawnY }, 1);
    this.sim.setPlayerHp('ally-bot', 0);
    this.currSnapshot = this.sim.getSnapshot();
    this.prevSnapshot = this.currSnapshot;
    this.collectSimulationEvents();
  }

  /** Método auxiliar para testar posicionamento de zumbis e visão na Etapa 2 */
  spawnZombieForTest(
    kind: 'common' | 'fast' | 'brute',
    x: number,
    y: number
  ): number | null {
    const z = this.sim.spawnZombie(kind, { x, y });
    this.currSnapshot = this.sim.getSnapshot();
    this.prevSnapshot = this.currSnapshot;
    return z ? z.id : null;
  }

  /** Método auxiliar para adicionar parede de bloqueio de visão/tiro em testes da Etapa 2 */
  addWallSegmentForTest(x1: number, y1: number, x2: number, y2: number): void {
    this.sim.addWallSegment({
      x1,
      y1,
      x2,
      y2,
      blocksVision: true,
      blocksProjectiles: true,
    });
    this.currSnapshot = this.sim.getSnapshot();
    this.prevSnapshot = this.currSnapshot;
  }

  updateFrame(frameDtMs: number, rawInput: Vec2, aimInput?: FrameAimInput): void {
    if (this.currSnapshot.gameOver) {
      return;
    }

    const clampedDtMs = Math.min(Math.max(0, frameDtMs), 200);
    this.accumulatorMs += clampedDtMs;

    const tickMs = BALANCE.SIMULATION.TICK_DT_MS;
    const normInput = normalizeInputVector(rawInput.x, rawInput.y);
    const normAim = aimInput
      ? normalizeInputVector(aimInput.aimX, aimInput.aimY)
      : { x: 0, y: 0 };

    let consumedOneShotActions = false;

    while (this.accumulatorMs >= tickMs && !this.currSnapshot.gameOver) {
      this.accumulatorMs -= tickMs;
      this.prevSnapshot = this.currSnapshot;

      const seq = this.nextSeq++;
      this.sim.step(tickMs, {
        [this.localPlayerId]: {
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
        },
      });
      consumedOneShotActions = true;

      this.currSnapshot = this.sim.getSnapshot();
      this.collectSimulationEvents();
    }
  }

  getRenderState(): RenderWorldState {
    const tickMs = BALANCE.SIMULATION.TICK_DT_MS;
    const alpha = this.currSnapshot.gameOver
      ? 1
      : Math.min(1, Math.max(0, this.accumulatorMs / tickMs));

    const prevPlayerMap = new Map<string, PlayerStateSnapshot>();
    for (const p of this.prevSnapshot.players) {
      prevPlayerMap.set(p.id, p);
    }

    const interpolatedPlayers: PlayerStateSnapshot[] = this.currSnapshot.players.map(
      (curr) => {
        const prev = prevPlayerMap.get(curr.id) ?? curr;
        return {
          ...curr,
          x: prev.x + (curr.x - prev.x) * alpha,
          y: prev.y + (curr.y - prev.y) * alpha,
        };
      }
    );

    const prevZombieMap = new Map<number, ZombieStateSnapshot>();
    for (const z of this.prevSnapshot.zombies) {
      prevZombieMap.set(z.id, z);
    }

    const interpolatedZombies: ZombieStateSnapshot[] = this.currSnapshot.zombies.map(
      (curr) => {
        const prev = prevZombieMap.get(curr.id) ?? curr;
        return {
          ...curr,
          x: prev.x + (curr.x - prev.x) * alpha,
          y: prev.y + (curr.y - prev.y) * alpha,
        };
      }
    );

    return {
      gameMode: this.currSnapshot.gameMode,
      tick: this.currSnapshot.tick,
      elapsedMs: this.currSnapshot.elapsedMs,
      seed: this.currSnapshot.seed,
      mapWidth: this.currSnapshot.mapWidth,
      mapHeight: this.currSnapshot.mapHeight,
      roomCode: 'SOLO',
      phase: this.currSnapshot.gameOver ? 'gameover' : 'playing',
      countdownMs: 0,
      gameOver: this.currSnapshot.gameOver,
      kills: this.currSnapshot.kills,
      totalDamageDealt: this.currSnapshot.totalDamageDealt,
      totalRevives: this.currSnapshot.totalRevives,
      structuresBuilt: this.currSnapshot.structuresBuilt,
      xp: this.currSnapshot.xp,
      level: this.currSnapshot.level,
      xpToNextLevel: this.currSnapshot.xpToNextLevel,
      weaponDamage: this.currSnapshot.weaponDamage,
      weaponFireRate: this.currSnapshot.weaponFireRate,
      lastLevelBonusLabel: this.currSnapshot.lastLevelBonusLabel,
      localPlayerId: this.localPlayerId,
      players: interpolatedPlayers,
      zombies: interpolatedZombies,
      props: this.currSnapshot.props,
      lootItems: this.currSnapshot.lootItems,
      lootContainers: this.currSnapshot.lootContainers,
      structures: this.currSnapshot.structures,
      roundsState: this.currSnapshot.roundsState,
      explorationState: this.currSnapshot.explorationState,
      interpolationAlpha: alpha,
      telemetry: {
        pingMs: 0,
        rxBytesPerSec: 0,
        txBytesPerSec: 0,
        pendingInputsCount: 0,
        simulatedLagMs: 0,
      },
    };
  }

  consumeNewEvents(): GameEvent[] {
    if (this.pendingClientEvents.length === 0) {
      return [];
    }
    const out = this.pendingClientEvents;
    this.pendingClientEvents = [];
    return out;
  }

  async disconnect(): Promise<void> {
    // Sem conexão remota no modo offline
  }

  private initSimulation(seed: number, gameMode: GameMode): void {
    this.accumulatorMs = 0;
    this.nextSeq = 1;
    this.pendingClientEvents = [];
    this.lastConsumedEventId = 0;

    this.sim = new Simulation({ seed, gameMode });
    this.sim.addPlayer(this.localPlayerId, {
      x: BALANCE.PLAYER.SPAWN_X,
      y: BALANCE.PLAYER.SPAWN_Y,
    });

    const initialSnap = this.sim.getSnapshot();
    this.prevSnapshot = initialSnap;
    this.currSnapshot = initialSnap;
    this.collectSimulationEvents();
  }

  private collectSimulationEvents(): void {
    const rawEvents = this.sim.consumeEvents();
    for (const ev of rawEvents) {
      if (ev.eventId > this.lastConsumedEventId) {
        this.lastConsumedEventId = ev.eventId;
        this.pendingClientEvents.push(ev);
      }
    }
  }
}
