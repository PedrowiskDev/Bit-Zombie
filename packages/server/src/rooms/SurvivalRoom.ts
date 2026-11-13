import { Client, Room, ServerError } from '@colyseus/core';
import {
  BALANCE,
  Simulation,
  isValidStructureKind,
  type EquippedSlotId,
  type GameMode,
  type TickInputMap,
} from '@zombie-coop/shared';
import {
  LootContainerSchema,
  LootItemSchema,
  PlayerSchema,
  StructureSchema,
  SurvivalRoomState,
  ZombieSchema,
} from '../schema/RoomState.js';
import { PlayerInputQueue } from './inputValidator.js';
import { roomRegistry } from './roomCode.js';

export interface RoomCreateOptions {
  protocolVersion?: number;
  seed?: number;
  gameMode?: GameMode;
  /** Permite ajustar o tempo de contagem ou reconexão em testes automatizados */
  countdownDurationMs?: number;
  reconnectGraceSec?: number;
}

export class SurvivalRoom extends Room<SurvivalRoomState> {
  maxClients = BALANCE.NETWORK.MAX_PLAYERS_PER_ROOM;
  autoDispose = true;

  private sim!: Simulation;
  private readonly inputQueues = new Map<string, PlayerInputQueue>();
  private countdownDurationMs: number = BALANCE.NETWORK.COUNTDOWN_DURATION_MS;
  private reconnectGraceSec: number = BALANCE.NETWORK.RECONNECT_GRACE_SEC;

  async onCreate(options: RoomCreateOptions = {}): Promise<void> {
    await this.setPrivate(true);

    const roomCode = roomRegistry.allocateUniqueCode();
    const seed =
      typeof options.seed === 'number' && Number.isInteger(options.seed) && options.seed > 0
        ? options.seed
        : Math.floor(Math.random() * 0x7fffffff) || BALANCE.SIMULATION.DEFAULT_SEED;
    const gameMode: GameMode =
      options.gameMode === 'exploration' ? 'exploration' : 'rounds';

    if (
      typeof options.countdownDurationMs === 'number' &&
      options.countdownDurationMs >= 50
    ) {
      this.countdownDurationMs = options.countdownDurationMs;
    }
    if (
      typeof options.reconnectGraceSec === 'number' &&
      options.reconnectGraceSec >= 0.1
    ) {
      this.reconnectGraceSec = options.reconnectGraceSec;
    }

    const state = new SurvivalRoomState();
    state.protocolVersion = BALANCE.PROTOCOL_VERSION;
    state.roomCode = roomCode;
    state.gameMode = gameMode;
    state.phase = 'lobby';
    state.countdownMs = this.countdownDurationMs;
    state.seed = seed;
    this.setState(state);

    this.sim = new Simulation({ seed, gameMode });
    this.syncSimulationToSchema();

    roomRegistry.register({
      roomCode,
      colyseusRoomId: this.roomId,
      gameMode,
      seed,
      phase: 'lobby',
      clientsCount: 0,
      maxClients: this.maxClients,
    });

    // Tick e patch rate fixos em 20 Hz (50 ms)
    this.setPatchRate(BALANCE.SIMULATION.TICK_DT_MS);
    this.setSimulationInterval(
      (dtMs) => this.updateRoomTick(dtMs),
      BALANCE.SIMULATION.TICK_DT_MS
    );

    this.registerMessageHandlers();
  }

  onAuth(_client: Client, options: RoomCreateOptions = {}): boolean {
    if (options.protocolVersion !== BALANCE.PROTOCOL_VERSION) {
      throw new ServerError(
        4001,
        `PROTOCOL_MISMATCH: Versão de protocolo incompatível (cliente=${String(
          options.protocolVersion
        )}, servidor=${BALANCE.PROTOCOL_VERSION}).`
      );
    }
    if (this.state.phase !== 'lobby' && this.state.phase !== 'countdown') {
      throw new ServerError(4002, 'MATCH_ALREADY_STARTED: A partida já está em andamento.');
    }
    return true;
  }

  onJoin(client: Client): void {
    const usedColors = new Set<number>();
    for (const p of this.state.players.values()) {
      usedColors.add(p.colorIndex);
    }
    const colorIndex = usedColors.has(0) ? 1 : 0;
    const spawnOffset = colorIndex === 0 ? -28 : 28;

    const simPlayer = this.sim.addPlayer(
      client.sessionId,
      {
        x: BALANCE.PLAYER.SPAWN_X + spawnOffset,
        y: BALANCE.PLAYER.SPAWN_Y,
      },
      colorIndex
    );

    // Limpa eventos iniciais de spawn no lobby
    this.sim.consumeEvents();

    const pSchema = new PlayerSchema();
    this.copyPlayerSnapshotToSchema(simPlayer, pSchema);
    this.state.players.set(client.sessionId, pSchema);
    this.inputQueues.set(client.sessionId, new PlayerInputQueue());

    this.syncSimulationToSchema();
    this.syncRegistrySummary();
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const sessionId = client.sessionId;
    const pSchema = this.state.players.get(sessionId);
    if (!pSchema) {
      return;
    }

    // No lobby ou saída voluntária no menu, remove o jogador imediatamente
    if (this.state.phase === 'lobby' || this.state.phase === 'countdown') {
      this.sim.removePlayer(sessionId);
      this.state.players.delete(sessionId);
      this.inputQueues.delete(sessionId);

      if (this.state.phase === 'countdown') {
        this.state.phase = 'lobby';
        this.state.countdownMs = this.countdownDurationMs;
      }
      this.syncRegistrySummary();
      return;
    }

    // Se a partida já acabou ou o jogador saiu voluntariamente durante o jogo: conta como morto
    if (this.state.phase === 'gameover' || consented) {
      pSchema.connected = false;
      this.sim.setPlayerConnected(sessionId, false);
      this.sim.setPlayerHp(sessionId, 0);
      this.syncSimulationToSchema();
      this.syncRegistrySummary();
      return;
    }

    // Desconexão inesperada durante 'playing':
    // Por até 20 segundos o personagem fica parado e invulnerável; depois conta como morto.
    pSchema.connected = false;
    pSchema.vx = 0;
    pSchema.vy = 0;
    this.sim.setPlayerConnected(sessionId, false);
    this.inputQueues.get(sessionId)?.reset();
    this.syncRegistrySummary();

    try {
      await this.allowReconnection(client, this.reconnectGraceSec);
      // Reconectou dentro dos 20s
      const currentSchema = this.state.players.get(sessionId);
      if (currentSchema) {
        currentSchema.connected = true;
      }
      this.sim.setPlayerConnected(sessionId, true);
      this.syncSimulationToSchema();
      this.syncRegistrySummary();
    } catch {
      // Expirou os 20s sem reconectar: conta como morto
      this.sim.setPlayerConnected(sessionId, false);
      this.sim.setPlayerHp(sessionId, 0);
      this.syncSimulationToSchema();
      this.syncRegistrySummary();
    }
  }

  onDispose(): void {
    if (this.state?.roomCode) {
      roomRegistry.unregister(this.state.roomCode);
    }
  }

  private registerMessageHandlers(): void {
    this.onMessage('input', (client, payload: unknown) => {
      if (this.state.phase !== 'playing') {
        return;
      }
      const queue = this.inputQueues.get(client.sessionId);
      if (queue) {
        queue.enqueue(payload);
      }
    });

    this.onMessage('ready', (client, payload: unknown) => {
      if (this.state.phase !== 'lobby' && this.state.phase !== 'countdown') {
        return;
      }
      const pSchema = this.state.players.get(client.sessionId);
      if (!pSchema) {
        return;
      }

      const nextReady =
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as Record<string, unknown>).ready === 'boolean'
          ? Boolean((payload as Record<string, unknown>).ready)
          : !pSchema.ready;

      pSchema.ready = nextReady;
      this.sim.setPlayerReady(client.sessionId, nextReady);
      this.evaluateLobbyReadiness();
    });

    this.onMessage('play_again', () => {
      if (this.state.phase !== 'gameover') {
        return;
      }
      this.restartMatch();
    });

    this.onMessage('skip_intermission', (client) => {
      if (this.state.phase !== 'playing') {
        return;
      }
      const accepted = this.sim.requestSkipRoundIntermission(client.sessionId);
      if (accepted) {
        this.syncSimulationToSchema();
        const events = this.sim.consumeEvents();
        if (events.length > 0) {
          this.broadcast('events', events);
        }
      }
    });

    this.onMessage('choose_upgrade', (client, payload: unknown) => {
      if (this.state.phase !== 'playing') {
        return;
      }
      const upgradeId =
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as Record<string, unknown>).upgradeId === 'string'
          ? (payload as Record<string, unknown>).upgradeId
          : payload;

      const applied = this.sim.chooseUpgrade(client.sessionId, upgradeId, false);
      if (applied) {
        this.syncSimulationToSchema();
        const events = this.sim.consumeEvents();
        if (events.length > 0) {
          this.broadcast('events', events);
        }
      }
    });

    this.onMessage('switch_slot', (client, payload: unknown) => {
      if (this.state.phase !== 'playing') {
        return;
      }
      const rawSlot =
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as Record<string, unknown>).slot === 'string'
          ? (payload as Record<string, unknown>).slot
          : payload;
      if (rawSlot === 'knife' || rawSlot === 'slot1' || rawSlot === 'slot2') {
        if (this.sim.switchPlayerSlot(client.sessionId, rawSlot as EquippedSlotId)) {
          this.syncSimulationToSchema();
        }
      }
    });

    this.onMessage('reload_weapon', (client) => {
      if (this.state.phase !== 'playing') {
        return;
      }
      if (this.sim.reloadPlayerWeapon(client.sessionId)) {
        this.syncSimulationToSchema();
      }
    });

    this.onMessage('interact_loot', (client) => {
      if (this.state.phase !== 'playing') {
        return;
      }
      if (this.sim.interactPlayerLoot(client.sessionId)) {
        this.syncSimulationToSchema();
        const events = this.sim.consumeEvents();
        if (events.length > 0) {
          this.broadcast('events', events);
        }
      }
    });

    this.onMessage('build_structure', (client, payload: unknown) => {
      if (this.state.phase !== 'playing') {
        return;
      }
      const rawKind =
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as Record<string, unknown>).kind === 'string'
          ? (payload as Record<string, unknown>).kind
          : payload;
      if (isValidStructureKind(rawKind)) {
        if (this.sim.buildPlayerStructure(client.sessionId, rawKind)) {
          this.syncSimulationToSchema();
          const events = this.sim.consumeEvents();
          if (events.length > 0) {
            this.broadcast('events', events);
          }
        }
      }
    });

    this.onMessage('repair_structure', (client) => {
      if (this.state.phase !== 'playing') {
        return;
      }
      if (this.sim.repairNearestStructure(client.sessionId)) {
        this.syncSimulationToSchema();
        const events = this.sim.consumeEvents();
        if (events.length > 0) {
          this.broadcast('events', events);
        }
      }
    });

    this.onMessage('use_medkit', (client) => {
      if (this.state.phase !== 'playing') {
        return;
      }
      if (this.sim.usePlayerMedkit(client.sessionId)) {
        this.syncSimulationToSchema();
        const events = this.sim.consumeEvents();
        if (events.length > 0) {
          this.broadcast('events', events);
        }
      }
    });

    this.onMessage('ping', (client, payload: unknown) => {
      const clientSentAt =
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as Record<string, unknown>).clientSentAt === 'number'
          ? (payload as Record<string, unknown>).clientSentAt
          : Date.now();

      client.send('pong', {
        clientSentAt,
        serverTick: this.state.tick,
        serverElapsedMs: this.state.elapsedMs,
      });
    });
  }

  private evaluateLobbyReadiness(): void {
    const playerList = Array.from(this.state.players.values());
    const bothPresentAndReady =
      playerList.length === BALANCE.NETWORK.MAX_PLAYERS_PER_ROOM &&
      playerList.every((p) => p.ready && p.connected);

    if (this.state.phase === 'lobby' && bothPresentAndReady) {
      this.state.phase = 'countdown';
      this.state.countdownMs = this.countdownDurationMs;
      this.syncRegistrySummary();
    } else if (this.state.phase === 'countdown' && !bothPresentAndReady) {
      this.state.phase = 'lobby';
      this.state.countdownMs = this.countdownDurationMs;
      this.syncRegistrySummary();
    }
  }

  private updateRoomTick(dtMs: number): void {
    const tickDtMs = BALANCE.SIMULATION.TICK_DT_MS;

    if (this.state.phase === 'countdown') {
      this.state.countdownMs = Math.max(0, this.state.countdownMs - dtMs);
      if (this.state.countdownMs <= 0) {
        this.state.phase = 'playing';
        this.syncRegistrySummary();
      }
      return;
    }

    if (this.state.phase !== 'playing') {
      return;
    }

    // Coleta no máximo 1 comando válido por jogador para este passo fixo de 50 ms
    const tickInputs: TickInputMap = {};
    for (const [sessionId, queue] of this.inputQueues.entries()) {
      const cmd = queue.popNextTickCommand();
      if (cmd) {
        tickInputs[sessionId] = cmd;
      }
    }

    this.sim.step(tickDtMs, tickInputs);
    this.syncSimulationToSchema();

    // Emite eventos transitórios de combate e diretores de modo
    const events = this.sim.consumeEvents();
    if (events.length > 0) {
      this.broadcast('events', events);
    }
  }

  private restartMatch(): void {
    const nextSeed = ((this.state.seed + 104729) >>> 0) || BALANCE.SIMULATION.DEFAULT_SEED;
    const gameMode = this.state.gameMode;
    this.state.seed = nextSeed;
    this.state.phase = 'playing';
    this.state.gameOver = false;
    this.state.zombies.clear();
    this.state.lootItems.clear();
    this.state.lootContainers.clear();
    this.state.structures.clear();

    this.sim = new Simulation({ seed: nextSeed, gameMode });

    for (const [sessionId, oldSchema] of this.state.players.entries()) {
      if (!oldSchema.connected) {
        this.state.players.delete(sessionId);
        this.inputQueues.delete(sessionId);
        continue;
      }
      const spawnOffset = oldSchema.colorIndex === 0 ? -28 : 28;
      this.sim.addPlayer(
        sessionId,
        {
          x: BALANCE.PLAYER.SPAWN_X + spawnOffset,
          y: BALANCE.PLAYER.SPAWN_Y,
        },
        oldSchema.colorIndex
      );
      this.sim.setPlayerReady(sessionId, true);
      this.inputQueues.get(sessionId)?.reset();
    }

    this.sim.consumeEvents();
    this.syncSimulationToSchema();
    this.syncRegistrySummary();
  }

  private syncSimulationToSchema(): void {
    const snap = this.sim.getSnapshot();

    this.state.gameMode = snap.gameMode;
    this.state.tick = snap.tick;
    this.state.elapsedMs = snap.elapsedMs;
    this.state.gameOver = snap.gameOver;
    this.state.kills = snap.kills;
    this.state.totalDamageDealt = snap.totalDamageDealt;
    this.state.totalRevives = snap.totalRevives;
    this.state.structuresBuilt = snap.structuresBuilt;
    this.state.xp = snap.xp;
    this.state.level = snap.level;
    this.state.xpToNextLevel = snap.xpToNextLevel;
    this.state.weaponDamage = snap.weaponDamage;
    this.state.weaponFireRate = snap.weaponFireRate;
    this.state.lastLevelBonusLabel = snap.lastLevelBonusLabel;

    // Sincroniza estado específico dos diretores de modo (Etapa 1)
    if (snap.roundsState) {
      this.state.roundNumber = snap.roundsState.roundNumber;
      this.state.roundPhase = snap.roundsState.roundPhase;
      this.state.isSpecialEliteRound = snap.roundsState.isSpecialEliteRound;
      this.state.roundTotalZombies = snap.roundsState.roundTotalZombies;
      this.state.roundRemainingZombies = snap.roundsState.roundRemainingZombies;
      this.state.intermissionRemainingMs = snap.roundsState.intermissionRemainingMs;
      this.state.roundsCompleted = snap.roundsState.roundsCompleted;
    }

    if (snap.explorationState) {
      this.state.explorationPhase = snap.explorationState.explorationPhase;
      this.state.daysSurvived = snap.explorationState.daysSurvived;
      this.state.hordeNumber = snap.explorationState.hordeNumber;
      this.state.hordesCleared = snap.explorationState.hordesCleared;
      this.state.timeUntilNextHordeMs = snap.explorationState.timeUntilNextHordeMs;
      this.state.warningRemainingMs = snap.explorationState.warningRemainingMs;
      this.state.recoveryRemainingMs = snap.explorationState.recoveryRemainingMs;
      this.state.hordeTotalZombies = snap.explorationState.hordeTotalZombies;
      this.state.hordeRemainingZombies = snap.explorationState.hordeRemainingZombies;
      this.state.sectorsExplored = snap.explorationState.sectorsExplored;
    }

    if (snap.gameOver && this.state.phase === 'playing') {
      this.state.phase = 'gameover';
      this.syncRegistrySummary();
    }

    // Sincroniza jogadores
    for (const pSnap of snap.players) {
      let pSchema = this.state.players.get(pSnap.id);
      if (!pSchema) {
        pSchema = new PlayerSchema();
        this.state.players.set(pSnap.id, pSchema);
      }
      this.copyPlayerSnapshotToSchema(pSnap, pSchema);
    }

    // Sincroniza zumbis vivos
    const activeZombieKeys = new Set<string>();
    for (const zSnap of snap.zombies) {
      const key = String(zSnap.id);
      activeZombieKeys.add(key);

      let zSchema = this.state.zombies.get(key);
      if (!zSchema) {
        zSchema = new ZombieSchema();
        zSchema.id = zSnap.id;
        zSchema.kind = zSnap.kind;
        zSchema.radius = zSnap.radius;
        zSchema.maxHp = zSnap.maxHp;
        zSchema.isElite = Boolean(zSnap.isElite);
        this.state.zombies.set(key, zSchema);
      }

      zSchema.x = Math.round(zSnap.x * 10) / 10;
      zSchema.y = Math.round(zSnap.y * 10) / 10;
      zSchema.vx = Math.round(zSnap.vx);
      zSchema.vy = Math.round(zSnap.vy);
      zSchema.facingAngle = Math.round(zSnap.facingAngle * 100) / 100;
      zSchema.hp = zSnap.hp;
      zSchema.isElite = Boolean(zSnap.isElite);
    }

    for (const existingKey of Array.from(this.state.zombies.keys())) {
      if (!activeZombieKeys.has(existingKey)) {
        this.state.zombies.delete(existingKey);
      }
    }

    // Sincroniza itens de loot no chão (Etapa 3)
    const activeLootKeys = new Set<string>();
    for (const item of snap.lootItems ?? []) {
      const key = String(item.id);
      activeLootKeys.add(key);
      let lSchema = this.state.lootItems.get(key);
      if (!lSchema) {
        lSchema = new LootItemSchema();
        lSchema.id = item.id;
        lSchema.kind = item.kind;
        lSchema.x = item.x;
        lSchema.y = item.y;
        lSchema.weaponId = item.weaponId ?? '';
        lSchema.magAmmo = item.magAmmo ?? 0;
        lSchema.ammoType = item.ammoType ?? '';
        lSchema.ammoAmount = item.ammoAmount ?? 0;
        lSchema.label = item.label;
        this.state.lootItems.set(key, lSchema);
      }
    }
    for (const existingKey of Array.from(this.state.lootItems.keys())) {
      if (!activeLootKeys.has(existingKey)) {
        this.state.lootItems.delete(existingKey);
      }
    }

    // Sincroniza recipientes pesquisáveis (Etapa 3)
    const activeContainerKeys = new Set<string>();
    for (const c of snap.lootContainers ?? []) {
      const key = String(c.id);
      activeContainerKeys.add(key);
      let cSchema = this.state.lootContainers.get(key);
      if (!cSchema) {
        cSchema = new LootContainerSchema();
        cSchema.id = c.id;
        cSchema.kind = c.kind;
        cSchema.x = c.x;
        cSchema.y = c.y;
        cSchema.label = c.label;
        this.state.lootContainers.set(key, cSchema);
      }
      cSchema.opened = c.opened;
    }
    for (const existingKey of Array.from(this.state.lootContainers.keys())) {
      if (!activeContainerKeys.has(existingKey)) {
        this.state.lootContainers.delete(existingKey);
      }
    }

    // Sincroniza estruturas construídas (Etapa 4)
    const activeStructureKeys = new Set<string>();
    for (const s of snap.structures ?? []) {
      const key = String(s.id);
      activeStructureKeys.add(key);
      let sSchema = this.state.structures.get(key);
      if (!sSchema) {
        sSchema = new StructureSchema();
        sSchema.id = s.id;
        sSchema.kind = s.kind;
        sSchema.x = s.x;
        sSchema.y = s.y;
        sSchema.radius = s.radius;
        sSchema.maxHp = s.maxHp;
        sSchema.ownerId = s.ownerId;
        sSchema.label = s.label;
        this.state.structures.set(key, sSchema);
      }
      sSchema.hp = s.hp;
    }
    for (const existingKey of Array.from(this.state.structures.keys())) {
      if (!activeStructureKeys.has(existingKey)) {
        this.state.structures.delete(existingKey);
      }
    }
  }

  private copyPlayerSnapshotToSchema(
    src: ReturnType<Simulation['getSnapshot']>['players'][number],
    dst: PlayerSchema
  ): void {
    dst.id = src.id;
    dst.colorIndex = src.colorIndex;
    dst.x = Math.round(src.x * 10) / 10;
    dst.y = Math.round(src.y * 10) / 10;
    dst.vx = Math.round(src.vx);
    dst.vy = Math.round(src.vy);
    dst.facingAngle = Math.round(src.facingAngle * 100) / 100;
    dst.radius = src.radius;
    dst.hp = src.hp;
    dst.maxHp = src.maxHp;
    dst.alive = src.alive;
    dst.connected = src.connected;
    dst.ready = src.ready;
    dst.aimMode = src.aimMode ?? 'auto';
    dst.invulnMs = src.invulnMs;
    dst.kills = src.kills;
    dst.lastProcessedSeq = src.lastProcessedSeq;
    dst.reviveProgress = Math.round((src.reviveProgress ?? 0) * 100) / 100;
    dst.pendingUpgradesCsv = (src.pendingUpgradeOptions ?? []).join(',');
    dst.pendingUpgradeTimerMs = Math.round(src.pendingUpgradeTimerMs ?? 0);
    dst.upgradesChosenCount = src.upgradesChosenCount ?? 0;
    dst.readyForNextRound = Boolean(src.readyForNextRound);
    dst.damageDealt = Math.round(src.damageDealt ?? 0);
    dst.revivesCount = src.revivesCount ?? 0;
    dst.activeSlot = src.activeSlot ?? 'knife';
    dst.activeWeaponId = src.activeWeaponId ?? 'knife';
    dst.slot1WeaponId = src.slot1WeaponId ?? '';
    dst.slot1MagAmmo = src.slot1MagAmmo ?? 0;
    dst.slot2WeaponId = src.slot2WeaponId ?? '';
    dst.slot2MagAmmo = src.slot2MagAmmo ?? 0;
    dst.ammoLight = src.ammoLight ?? 0;
    dst.ammoShells = src.ammoShells ?? 0;
    dst.ammoHeavy = src.ammoHeavy ?? 0;
    dst.reloadRemainingMs = Math.round(src.reloadRemainingMs ?? 0);
    dst.reloadTotalMs = Math.round(src.reloadTotalMs ?? 0);
    dst.meleePhase = src.meleePhase ?? 'idle';
    dst.wood = src.wood ?? 0;
    dst.scrap = src.scrap ?? 0;
    dst.medkits = src.medkits ?? 0;
  }

  private syncRegistrySummary(): void {
    if (!this.state?.roomCode) {
      return;
    }
    let connectedCount = 0;
    for (const p of this.state.players.values()) {
      if (p.connected) {
        connectedCount += 1;
      }
    }
    roomRegistry.update(this.state.roomCode, {
      gameMode: this.state.gameMode,
      seed: this.state.seed,
      phase: this.state.phase,
      clientsCount: connectedCount,
    });
  }
}
