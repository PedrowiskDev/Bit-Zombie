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
  AmmoType,
  BuildableStructureSnapshot,
  EquippedSlotId,
  GameEvent,
  GameMode,
  HordeClearedEvent,
  HordeStartedEvent,
  HordeWarningEvent,
  InputCmd,
  LevelUpEvent,
  LootContainerSnapshot,
  LootPickedEvent,
  MeleeSwingEvent,
  PlayerDamagedEvent,
  PlayerHealedEvent,
  PlayerRevivedEvent,
  PlayerSpawnedEvent,
  PlayerStateSnapshot,
  ProjectileHitEvent,
  PropData,
  ResourceKind,
  RoundCompletedEvent,
  RoundStartedEvent,
  StructureBuiltEvent,
  StructureDamagedEvent,
  StructureKind,
  StructureRepairedEvent,
  TickInputMap,
  UpgradeChosenEvent,
  WeaponFireEvent,
  WeaponId,
  WeaponNoiseEvent,
  WorldLootItemSnapshot,
  WorldSnapshot,
  ZombieKind,
  ZombieStateSnapshot,
} from '../types/protocol.js';
import {
  resolvePlayerZombieCollisionsAndContactDamage,
  stepPlayerReviveMechanics,
  stepPlayerWeaponsAndMelee,
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
  canAffordStructure,
  deductStructureCost,
  findValidStructurePlacement,
  getStructureDefinition,
  isValidStructureKind,
  stepStructuresAndZombieInteractions,
  type InternalBuildableStructure,
} from './structures.js';
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
import {
  buildObstaclesFromProps,
  resolveEntityObstacleCollisions,
  type SegmentObstacle,
  type VisionObstacles,
} from './vision.js';
import {
  addAmmoToInventory,
  createInitialPlayerInventory,
  generateWorldLootAndContainers,
  getActiveWeaponId,
  getWeaponDefinition,
  giveWeaponToInventory,
  startWeaponReload,
  switchPlayerWeaponSlot,
  syncPlayerInventorySnapshotFields,
  type InternalLootContainer,
  type PlayerWeaponInventory,
} from './weapons.js';

export interface SimulationOptions {
  seed?: number;
  gameMode?: GameMode;
  mapWidth?: number;
  mapHeight?: number;
  /** Permite desativar o spawn automático por tempo/diretor em testes unitários isolados */
  enableAutoSpawn?: boolean;
  /** Permite sobrescrever tempos de horda em testes específicos do modo Exploração */
  explorationTimingOverrides?: ExplorationTimingOverrides;
  /** Arma inicial dos jogadores (padrão na Etapa 3: 'knife') */
  startingWeapon?: WeaponId;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * Simulação determinística pura (Fase 1 + Fase 2 + Etapa 1 Modos + Etapa 2 Visão + Etapa 3 Armas/Loot + Etapa 4 Abrigo/Fortificação).
 * - Não importa Phaser nem Colyseus.
 * - Avança em passo fixo de 20 Hz (`TICK_DT_MS = 50` ms).
 * - Suporta os dois modos de jogo sobre o mesmo mapa-base (`'rounds'` e `'exploration'`).
 * - Valida campo de visão (`110°`), linha de visão (`hasLineOfSight`) e bloqueio de golpes/projéteis por obstáculos sólidos.
 * - Começa com Faca (`'knife'`) e gerencia 2 slots de armas encontradas + reserva de munição, recarga e loot atômico.
 * - Gerencia recursos (`wood`, `scrap`, `medkits`), construção de barricadas/armadilhas, reparo e ataques de zumbis contra estruturas.
 */
export class Simulation {
  private seed: number;
  private gameMode: GameMode;
  private readonly startingWeapon: WeaponId;
  private rng: SeededRng;
  private upgradeRng: SeededRng;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private readonly enableAutoSpawn: boolean;
  private props: PropData[];
  private readonly wallSegments: SegmentObstacle[] = [];
  private visionObstacles: VisionObstacles;
  private readonly players: Map<string, PlayerStateSnapshot> = new Map();
  private readonly inventoriesByPlayer: Map<string, PlayerWeaponInventory> = new Map();
  private readonly manualAimByPlayer: Map<string, PlayerManualAimInput> = new Map();
  private readonly upgradesByPlayer: Map<string, AppliedUpgradeStack[]> = new Map();
  private readonly pendingOffersByPlayer: Map<string, PendingUpgradeOffer[]> = new Map();
  private readonly zombies: ZombieStateSnapshot[] = [];
  private readonly projectiles: SimulatedProjectile[] = [];
  private lootItems: WorldLootItemSnapshot[] = [];
  private lootContainers: InternalLootContainer[] = [];
  private readonly structures: InternalBuildableStructure[] = [];
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
  private nextLootId = 1;
  private nextStructureId = 1;

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
    this.startingWeapon = options.startingWeapon ?? 'knife';
    this.rng = new SeededRng(this.seed);
    this.upgradeRng = new SeededRng((this.seed ^ 0x9e3779b9) >>> 0);
    this.mapWidth = options.mapWidth ?? BALANCE.MAP.WIDTH;
    this.mapHeight = options.mapHeight ?? BALANCE.MAP.HEIGHT;
    this.enableAutoSpawn = options.enableAutoSpawn ?? true;
    this.props = generateMapProps(this.seed);
    const generatedLoot = generateWorldLootAndContainers(
      this.seed,
      this.props,
      this.mapWidth,
      this.mapHeight
    );
    this.lootItems = generatedLoot.lootItems;
    this.lootContainers = generatedLoot.lootContainers;
    this.nextLootId = generatedLoot.nextLootId;
    this.visionObstacles = buildObstaclesFromProps(
      this.props,
      this.wallSegments,
      [],
      this.lootContainers,
      this.structures
    );

    this.roundsDirector = new RoundsDirector(this.seed);
    this.explorationDirector = new ExplorationDirector(
      this.seed,
      this.mapWidth,
      this.mapHeight,
      options.explorationTimingOverrides
    );
  }

  private rebuildObstacles(): void {
    this.visionObstacles = buildObstaclesFromProps(
      this.props,
      this.wallSegments,
      [],
      this.lootContainers,
      this.structures
    );
  }

  getGameMode(): GameMode {
    return this.gameMode;
  }

  setGameMode(mode: GameMode): void {
    this.gameMode = mode === 'exploration' ? 'exploration' : 'rounds';
  }

  getVisionObstacles(): VisionObstacles {
    return this.visionObstacles;
  }

  addWallSegment(segment: SegmentObstacle): void {
    this.wallSegments.push({ ...segment });
    this.rebuildObstacles();
  }

  clearWallSegments(): void {
    this.wallSegments.length = 0;
    this.rebuildObstacles();
  }

  /** Remove props estáticos gerados proceduralmente (usado em testes unitários determinísticos de linha de visão) */
  clearPropsForTesting(): void {
    this.props = [];
    this.rebuildObstacles();
  }

  /** Remove todo o loot e recipientes gerados proceduralmente (usado em testes unitários isolados de loot) */
  clearLootForTesting(): void {
    this.lootItems = [];
    this.lootContainers = [];
    this.rebuildObstacles();
  }

  /** Remove todas as fortificações construídas (usado em testes unitários isolados) */
  clearStructuresForTesting(): void {
    this.structures.length = 0;
    this.rebuildObstacles();
  }

  /** Instancia um item de loot no chão (usado em testes ou ao trocar de arma) */
  spawnLootItem(item: Omit<WorldLootItemSnapshot, 'id'>): WorldLootItemSnapshot {
    const clamped = clampPositionToArena(
      item.x,
      item.y,
      20,
      this.mapWidth,
      this.mapHeight
    );
    const created: WorldLootItemSnapshot = {
      ...item,
      id: this.nextLootId++,
      x: clamped.x,
      y: clamped.y,
    };
    this.lootItems.push(created);
    return { ...created };
  }

  /** Instancia um recipiente pesquisável (usado em testes) */
  spawnLootContainer(
    container: Omit<InternalLootContainer, 'id' | 'opened'>
  ): LootContainerSnapshot {
    const clamped = clampPositionToArena(
      container.x,
      container.y,
      24,
      this.mapWidth,
      this.mapHeight
    );
    const created: InternalLootContainer = {
      ...container,
      id: this.nextLootId++,
      x: clamped.x,
      y: clamped.y,
      opened: false,
    };
    this.lootContainers.push(created);
    this.rebuildObstacles();
    return {
      id: created.id,
      kind: created.kind,
      x: created.x,
      y: created.y,
      opened: created.opened,
      label: created.label,
    };
  }

  /** Concede ou equipa diretamente uma arma para o jogador `playerId` */
  giveWeapon(
    playerId: string,
    weaponId: WeaponId,
    magAmmo?: number,
    autoSelect = true
  ): boolean {
    const player = this.players.get(playerId);
    const inv = this.inventoriesByPlayer.get(playerId);
    if (!player || !inv) {
      return false;
    }
    const res = giveWeaponToInventory(inv, weaponId, magAmmo, autoSelect);
    if (res.droppedWeapon) {
      const droppedDef = getWeaponDefinition(res.droppedWeapon.weaponId);
      this.spawnLootItem({
        kind: 'weapon',
        x: player.x + Math.cos(player.facingAngle + Math.PI) * 24,
        y: player.y + Math.sin(player.facingAngle + Math.PI) * 24,
        weaponId: res.droppedWeapon.weaponId,
        magAmmo: res.droppedWeapon.magAmmo,
        label: droppedDef.name,
      });
    }
    syncPlayerInventorySnapshotFields(player, inv);
    return true;
  }

  /** Adiciona munição à reserva do jogador `playerId` */
  addAmmo(
    playerId: string,
    ammoType: Exclude<AmmoType, 'none'>,
    amount: number
  ): boolean {
    const player = this.players.get(playerId);
    const inv = this.inventoriesByPlayer.get(playerId);
    if (!player || !inv) {
      return false;
    }
    addAmmoToInventory(inv, ammoType, amount);
    syncPlayerInventorySnapshotFields(player, inv);
    return true;
  }

  /** Adiciona Madeira ou Sucata ao inventário do jogador `playerId` (Etapa 4) */
  addResource(
    playerId: string,
    kind: ResourceKind,
    amount: number
  ): boolean {
    const player = this.players.get(playerId);
    if (!player || !Number.isFinite(amount) || amount <= 0) {
      return false;
    }
    const delta = Math.round(amount);
    if (kind === 'wood') {
      player.wood = (player.wood ?? 0) + delta;
    } else {
      player.scrap = (player.scrap ?? 0) + delta;
    }
    return true;
  }

  /** Adiciona Kits Médicos ao inventário do jogador `playerId` (Etapa 4) */
  addMedkit(playerId: string, amount = 1): boolean {
    const player = this.players.get(playerId);
    if (!player || !Number.isFinite(amount) || amount <= 0) {
      return false;
    }
    player.medkits = (player.medkits ?? 0) + Math.round(amount);
    return true;
  }

  /**
   * Usa 1 Kit Médico para restaurar HP do jogador (`MEDKIT_HEAL_HP = 45`),
   * desde que esteja vivo, conectado, com `hp < maxHp` e possua `medkits > 0` (Etapa 4).
   */
  usePlayerMedkit(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (
      !player ||
      !player.alive ||
      !player.connected ||
      player.hp >= player.maxHp ||
      (player.medkits ?? 0) <= 0
    ) {
      return false;
    }

    const prevHp = player.hp;
    player.medkits = Math.max(0, (player.medkits ?? 0) - 1);
    player.hp = Math.min(player.maxHp, player.hp + BALANCE.SURVIVAL.MEDKIT_HEAL_HP);
    const restored = player.hp - prevHp;

    const healEv: Omit<PlayerHealedEvent, 'eventId' | 'tick'> = {
      type: 'player_healed',
      playerId,
      hpRestored: restored,
      hpCurrent: player.hp,
      x: player.x,
      y: player.y,
    };
    this.emitEvent(healEv);
    return true;
  }

  /**
   * Constrói uma fortificação (`'wood_barricade' | 'scrap_barricade' | 'spike_trap'`) à frente do jogador,
   * validando recursos suficientes e ausência de sobreposição física (Etapa 4).
   */
  buildPlayerStructure(
    playerId: string,
    kind: StructureKind
  ): BuildableStructureSnapshot | null {
    const player = this.players.get(playerId);
    if (
      !player ||
      !player.alive ||
      !player.connected ||
      !isValidStructureKind(kind) ||
      !canAffordStructure(player, kind)
    ) {
      return null;
    }

    const playerList = Array.from(this.players.values());
    const placement = findValidStructurePlacement(
      player,
      kind,
      playerList,
      this.structures,
      this.visionObstacles,
      this.mapWidth,
      this.mapHeight
    );
    if (!placement) {
      return null;
    }

    deductStructureCost(player, kind);
    const def = getStructureDefinition(kind);
    const created: InternalBuildableStructure = {
      id: this.nextStructureId++,
      kind,
      x: placement.x,
      y: placement.y,
      rotation: Number(player.facingAngle.toFixed(3)),
      radius: def.radiusPx,
      hp: def.maxHp,
      maxHp: def.maxHp,
      ownerId: playerId,
      label: def.name,
      attackCooldownMs: 0,
      trapTickCooldownMs: 0,
    };

    this.structures.push(created);
    this.structuresBuilt += 1;
    this.rebuildObstacles();

    const builtEv: Omit<StructureBuiltEvent, 'eventId' | 'tick'> = {
      type: 'structure_built',
      playerId,
      structureId: created.id,
      kind: created.kind,
      label: created.label,
      x: created.x,
      y: created.y,
    };
    this.emitEvent(builtEv);

    return {
      id: created.id,
      kind: created.kind,
      x: created.x,
      y: created.y,
      rotation: created.rotation,
      radius: created.radius,
      hp: created.hp,
      maxHp: created.maxHp,
      ownerId: created.ownerId,
      label: created.label,
    };
  }

  /**
   * Repara a fortificação danificada mais próxima dentro de `REPAIR_RADIUS_PX` (78 px),
   * consumindo `REPAIR_WOOD_COST` (1 Madeira) e restaurando `+90 HP` (Etapa 4).
   */
  repairNearestStructure(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (
      !player ||
      !player.alive ||
      !player.connected ||
      (player.wood ?? 0) < BALANCE.STRUCTURES.REPAIR_WOOD_COST
    ) {
      return false;
    }

    const maxDistSq =
      BALANCE.STRUCTURES.REPAIR_RADIUS_PX * BALANCE.STRUCTURES.REPAIR_RADIUS_PX;
    let bestStruct: InternalBuildableStructure | null = null;
    let bestDistSq = maxDistSq;

    for (let i = 0; i < this.structures.length; i += 1) {
      const s = this.structures[i];
      if (s.hp <= 0 || s.hp >= s.maxHp) {
        continue;
      }
      const dx = s.x - player.x;
      const dy = s.y - player.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        bestStruct = s;
      }
    }

    if (!bestStruct) {
      return false;
    }

    const prevHp = bestStruct.hp;
    player.wood = Math.max(
      0,
      (player.wood ?? 0) - BALANCE.STRUCTURES.REPAIR_WOOD_COST
    );
    bestStruct.hp = Math.min(
      bestStruct.maxHp,
      bestStruct.hp + BALANCE.STRUCTURES.REPAIR_HP_AMOUNT
    );
    const restored = bestStruct.hp - prevHp;

    const repEv: Omit<StructureRepairedEvent, 'eventId' | 'tick'> = {
      type: 'structure_repaired',
      playerId,
      structureId: bestStruct.id,
      kind: bestStruct.kind,
      x: bestStruct.x,
      y: bestStruct.y,
      hpRestored: restored,
      hpCurrent: bestStruct.hp,
    };
    this.emitEvent(repEv);
    return true;
  }

  /** Troca o slot de arma ativo (`'knife' | 'slot1' | 'slot2'`) do jogador */
  switchPlayerSlot(playerId: string, targetSlot: EquippedSlotId): boolean {
    const player = this.players.get(playerId);
    const inv = this.inventoriesByPlayer.get(playerId);
    if (!player || !inv || !player.alive || !player.connected) {
      return false;
    }
    const ok = switchPlayerWeaponSlot(inv, targetSlot);
    if (ok) {
      player.fireCooldownMs = 0;
    }
    syncPlayerInventorySnapshotFields(player, inv);
    return ok;
  }

  /** Inicia manualmente a recarga da arma de fogo equipada no slot ativo */
  reloadPlayerWeapon(playerId: string): boolean {
    const player = this.players.get(playerId);
    const inv = this.inventoriesByPlayer.get(playerId);
    if (!player || !inv || !player.alive || !player.connected) {
      return false;
    }
    const weaponId = getActiveWeaponId(inv);
    const eff = this.getPlayerEffectiveStats(playerId, weaponId);
    const ok = startWeaponReload(inv, eff.reloadSpeedMultiplier);
    syncPlayerInventorySnapshotFields(player, inv);
    return ok;
  }

  /**
   * Tenta pegar o item de loot mais próximo ou abrir o recipiente pesquisável mais próximo.
   * Totalmente autoritativo e atômico: dois jogadores tentando pegar o mesmo item no mesmo tick
   * nunca duplicam o loot.
   */
  interactPlayerLoot(playerId: string): boolean {
    const player = this.players.get(playerId);
    const inv = this.inventoriesByPlayer.get(playerId);
    if (!player || !inv || !player.alive || !player.connected) {
      return false;
    }

    // 1. Procura o item de chão mais próximo dentro de PICKUP_RADIUS_PX
    const pickupRadiusSq =
      BALANCE.LOOT.PICKUP_RADIUS_PX * BALANCE.LOOT.PICKUP_RADIUS_PX;
    let bestItemIdx = -1;
    let bestItemDistSq = pickupRadiusSq;

    for (let i = 0; i < this.lootItems.length; i += 1) {
      const item = this.lootItems[i];
      const dx = item.x - player.x;
      const dy = item.y - player.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestItemDistSq) {
        bestItemDistSq = distSq;
        bestItemIdx = i;
      }
    }

    if (bestItemIdx >= 0) {
      const [picked] = this.lootItems.splice(bestItemIdx, 1);
      if (picked.kind === 'weapon' && picked.weaponId) {
        const res = giveWeaponToInventory(
          inv,
          picked.weaponId,
          picked.magAmmo,
          true
        );
        if (res.droppedWeapon) {
          const droppedDef = getWeaponDefinition(res.droppedWeapon.weaponId);
          this.spawnLootItem({
            kind: 'weapon',
            x: picked.x,
            y: picked.y,
            weaponId: res.droppedWeapon.weaponId,
            magAmmo: res.droppedWeapon.magAmmo,
            label: droppedDef.name,
          });
        }
      } else if (picked.kind === 'ammo' && picked.ammoType && picked.ammoAmount) {
        addAmmoToInventory(inv, picked.ammoType, picked.ammoAmount);
      } else if (
        picked.kind === 'resource' &&
        picked.resourceKind &&
        picked.resourceAmount
      ) {
        this.addResource(playerId, picked.resourceKind, picked.resourceAmount);
      } else if (picked.kind === 'medkit') {
        this.addMedkit(playerId, picked.resourceAmount ?? 1);
      }

      syncPlayerInventorySnapshotFields(player, inv);
      const pickedEv: Omit<LootPickedEvent, 'eventId' | 'tick'> = {
        type: 'loot_picked',
        playerId,
        lootId: picked.id,
        kind: picked.kind,
        label: picked.label,
        x: picked.x,
        y: picked.y,
      };
      this.emitEvent(pickedEv);
      return true;
    }

    // 2. Caso não haja item no chão, procura o recipiente fechado mais próximo dentro de CONTAINER_INTERACT_RADIUS_PX
    const containerRadiusSq =
      BALANCE.LOOT.CONTAINER_INTERACT_RADIUS_PX *
      BALANCE.LOOT.CONTAINER_INTERACT_RADIUS_PX;
    let bestContainer: InternalLootContainer | null = null;
    let bestContainerDistSq = containerRadiusSq;

    for (let i = 0; i < this.lootContainers.length; i += 1) {
      const c = this.lootContainers[i];
      if (c.opened) {
        continue;
      }
      const dx = c.x - player.x;
      const dy = c.y - player.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestContainerDistSq) {
        bestContainerDistSq = distSq;
        bestContainer = c;
      }
    }

    if (bestContainer) {
      bestContainer.opened = true;
      for (let i = 0; i < bestContainer.contents.length; i += 1) {
        const entry = bestContainer.contents[i];
        const offsetAngle = (i * Math.PI * 0.65) - 0.3;
        const dropX = bestContainer.x + Math.cos(offsetAngle) * 26;
        const dropY = bestContainer.y + Math.sin(offsetAngle) * 26;

        if (entry.kind === 'ammo') {
          addAmmoToInventory(inv, entry.ammoType, entry.ammoAmount);
        } else if (entry.kind === 'weapon') {
          if (!inv.slot1 || !inv.slot2) {
            giveWeaponToInventory(inv, entry.weaponId, entry.magAmmo, true);
          } else {
            this.spawnLootItem({
              kind: 'weapon',
              x: dropX,
              y: dropY,
              weaponId: entry.weaponId,
              magAmmo: entry.magAmmo,
              label: entry.label,
            });
          }
        }
      }

      // Concede também recursos de sobrevivência (Madeira, Sucata e Kit Médico em Caixotes de Suprimento — Etapa 4)
      player.wood =
        (player.wood ?? 0) + BALANCE.SURVIVAL.CONTAINER_BONUS_WOOD;
      player.scrap =
        (player.scrap ?? 0) + BALANCE.SURVIVAL.CONTAINER_BONUS_SCRAP;
      if (bestContainer.kind === 'supply_crate') {
        player.medkits = (player.medkits ?? 0) + 1;
      }

      syncPlayerInventorySnapshotFields(player, inv);
      const containerEv: Omit<LootPickedEvent, 'eventId' | 'tick'> = {
        type: 'loot_picked',
        playerId,
        lootId: bestContainer.id,
        kind: 'container',
        label: bestContainer.label,
        x: bestContainer.x,
        y: bestContainer.y,
      };
      this.emitEvent(containerEv);
      return true;
    }

    return false;
  }

  /**
   * Reinicia a partida com uma nova seed determinística (e opcionalmente um novo modo),
   * restaurando os jogadores conectados para o centro do mapa com vida máxima e zerando
   * diretores, ondas, nível, projéteis, armas, fortificações e estatísticas.
   */
  resetMatch(newSeed?: number, newGameMode?: GameMode): void {
    this.seed = (newSeed ?? (this.seed + 1)) >>> 0;
    if (newGameMode) {
      this.gameMode = newGameMode === 'exploration' ? 'exploration' : 'rounds';
    }
    this.rng = new SeededRng(this.seed);
    this.upgradeRng = new SeededRng((this.seed ^ 0x9e3779b9) >>> 0);
    this.props = generateMapProps(this.seed);
    this.wallSegments.length = 0;
    this.structures.length = 0;
    this.nextStructureId = 1;
    const generatedLoot = generateWorldLootAndContainers(
      this.seed,
      this.props,
      this.mapWidth,
      this.mapHeight
    );
    this.lootItems = generatedLoot.lootItems;
    this.lootContainers = generatedLoot.lootContainers;
    this.nextLootId = generatedLoot.nextLootId;
    this.rebuildObstacles();

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
      player.wood = BALANCE.SURVIVAL.STARTING_WOOD;
      player.scrap = BALANCE.SURVIVAL.STARTING_SCRAP;
      player.medkits = BALANCE.SURVIVAL.STARTING_MEDKITS;

      const freshInv = createInitialPlayerInventory(this.startingWeapon);
      this.inventoriesByPlayer.set(player.id, freshInv);
      syncPlayerInventorySnapshotFields(player, freshInv);

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

    const inv = createInitialPlayerInventory(this.startingWeapon);

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
      wood: BALANCE.SURVIVAL.STARTING_WOOD,
      scrap: BALANCE.SURVIVAL.STARTING_SCRAP,
      medkits: BALANCE.SURVIVAL.STARTING_MEDKITS,
    };

    syncPlayerInventorySnapshotFields(player, inv);

    this.players.set(playerId, player);
    this.inventoriesByPlayer.set(playerId, inv);
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
    this.inventoriesByPlayer.delete(playerId);
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
      speedMultiplier?: number;
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
      const rawRingPos = pickRingSpawnPosition(
        this.rng,
        livingPlayers,
        stats.radius,
        this.mapWidth,
        this.mapHeight
      );
      spawnCoords = resolveEntityObstacleCollisions(
        rawRingPos.x,
        rawRingPos.y,
        stats.radius,
        this.visionObstacles,
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
        speedMultiplier: options?.speedMultiplier,
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
  getPlayerEffectiveStats(
    playerId: string,
    weaponIdOverride?: WeaponId
  ): EffectiveWeaponStats {
    const playerStacks = this.upgradesByPlayer.get(playerId) ?? [];
    const inv = this.inventoriesByPlayer.get(playerId);
    const activeWep = weaponIdOverride ?? (inv ? getActiveWeaponId(inv) : 'pistol');
    return computeEffectiveWeaponStats(this.level, playerStacks, activeWep);
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

      // 1. Atualiza contadores de invulnerabilidade/cooldown, ações de arma/loot e move jogadores vivos e conectados
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

          // Ações de troca de arma, recarga e interação/loot enviadas via comando
          if (
            rawCmd.switchSlot === 'knife' ||
            rawCmd.switchSlot === 'slot1' ||
            rawCmd.switchSlot === 'slot2'
          ) {
            this.switchPlayerSlot(playerId, rawCmd.switchSlot);
          }
          if (rawCmd.reload === true) {
            this.reloadPlayerWeapon(playerId);
          }
          if (rawCmd.interact === true) {
            this.interactPlayerLoot(playerId);
          }
          if (rawCmd.buildStructure && isValidStructureKind(rawCmd.buildStructure)) {
            this.buildPlayerStructure(playerId, rawCmd.buildStructure);
          }
          if (rawCmd.repairStructure === true) {
            this.repairNearestStructure(playerId);
          }
          if (rawCmd.useMedkit === true) {
            this.usePlayerMedkit(playerId);
          }
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
          this.mapHeight,
          this.visionObstacles
        );

        player.x = moved.x;
        player.y = moved.y;
        player.vx = moved.vx;
        player.vy = moved.vy;

        const currentAim = this.manualAimByPlayer.get(playerId);
        if (currentAim && (currentAim.aimX !== 0 || currentAim.aimY !== 0)) {
          player.facingAngle = Math.atan2(currentAim.aimY, currentAim.aimX);
        } else if (moved.vx !== 0 || moved.vy !== 0) {
          player.facingAngle = Math.atan2(moved.vy, moved.vx);
        }

        // Coleta automática de munição ao passar por cima (ou arma se houver slot livre)
        this.tryAutoWalkPickup(playerId, player);
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

      // 3. Movimento de perseguição dos zumbis existentes, separação suave e colisão com objetos sólidos do cenário
      stepZombiesMovementAndSeparation(
        this.zombies,
        playerList,
        tickDtSec,
        this.mapWidth,
        this.mapHeight,
        this.spatialGrid,
        this.visionObstacles
      );

      // 3b. Ataques de zumbis contra barricadas e dano/lentidão de armadilhas de espinhos (Etapa 4)
      stepStructuresAndZombieInteractions({
        structures: this.structures,
        zombies: this.zombies,
        dtMs: tickDtMs,
        emitDamaged: (ev: Omit<StructureDamagedEvent, 'eventId' | 'tick'>) =>
          this.emitEvent(ev),
        onStructureDestroyed: () => {
          this.rebuildObstacles();
        },
        onZombieKilledByTrap: (zombie) => this.handleZombieKilled(zombie),
      });

      // 4. Colisão círculo-círculo jogador-zumbi e dano de contato com invulnerabilidade (0,8 s)
      resolvePlayerZombieCollisionsAndContactDamage(
        playerList,
        this.zombies,
        this.mapWidth,
        this.mapHeight,
        (ev: Omit<PlayerDamagedEvent, 'eventId' | 'tick'>) => this.emitEvent(ev),
        this.visionObstacles
      );

      // 5. Ataque corpo a corpo em arco (faca/bastão), recarga, consumo de munição e disparos de armas de fogo (Etapa 3)
      stepPlayerWeaponsAndMelee({
        players: playerList,
        inventoriesByPlayer: this.inventoriesByPlayer,
        zombies: this.zombies,
        projectiles: this.projectiles,
        dtMs: tickDtMs,
        mapWidth: this.mapWidth,
        mapHeight: this.mapHeight,
        manualAimByPlayer: this.manualAimByPlayer,
        getPlayerEffectiveStats: (pid, wid) => this.getPlayerEffectiveStats(pid, wid),
        obstacles: this.visionObstacles,
        allocateProjectileId: () => this.nextProjectileId++,
        emitFire: (ev: Omit<WeaponFireEvent, 'eventId' | 'tick'>) => this.emitEvent(ev),
        emitMeleeSwing: (ev: Omit<MeleeSwingEvent, 'eventId' | 'tick'>) =>
          this.emitEvent(ev),
        emitNoise: (ev: Omit<WeaponNoiseEvent, 'eventId' | 'tick'>) =>
          this.emitEvent(ev),
        emitHit: (ev: Omit<ProjectileHitEvent, 'eventId' | 'tick'>) =>
          this.emitEvent(ev),
        onZombieKilled: (zombie) => this.handleZombieKilled(zombie),
        onDamageDealt: (damage) => {
          this.totalDamageDealt = Number((this.totalDamageDealt + damage).toFixed(1));
        },
      });

      // 6. Simulação dos projéteis e detecção de acerto/abate/perfuração e bloqueio por obstáculos sólidos
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
        },
        this.visionObstacles
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
      lootItems: this.lootItems.map((item) => ({ ...item })),
      lootContainers: this.lootContainers.map((c) => ({
        id: c.id,
        kind: c.kind,
        x: c.x,
        y: c.y,
        opened: c.opened,
        label: c.label,
      })),
      structures: this.structures.map((s) => ({ ...s })),
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

  private tryAutoWalkPickup(playerId: string, player: PlayerStateSnapshot): void {
    const inv = this.inventoriesByPlayer.get(playerId);
    if (!inv || !player.alive || !player.connected) {
      return;
    }

    const walkRadiusSq = 28 * 28;
    for (let i = 0; i < this.lootItems.length; i += 1) {
      const item = this.lootItems[i];
      const dx = item.x - player.x;
      const dy = item.y - player.y;
      if (dx * dx + dy * dy > walkRadiusSq) {
        continue;
      }

      if (item.kind === 'ammo' && item.ammoType && item.ammoAmount) {
        this.lootItems.splice(i, 1);
        addAmmoToInventory(inv, item.ammoType, item.ammoAmount);
        syncPlayerInventorySnapshotFields(player, inv);
        const pickedEv: Omit<LootPickedEvent, 'eventId' | 'tick'> = {
          type: 'loot_picked',
          playerId,
          lootId: item.id,
          kind: item.kind,
          label: item.label,
          x: item.x,
          y: item.y,
        };
        this.emitEvent(pickedEv);
        return;
      }

      if (item.kind === 'resource' && item.resourceKind && item.resourceAmount) {
        this.lootItems.splice(i, 1);
        this.addResource(playerId, item.resourceKind, item.resourceAmount);
        const pickedEv: Omit<LootPickedEvent, 'eventId' | 'tick'> = {
          type: 'loot_picked',
          playerId,
          lootId: item.id,
          kind: item.kind,
          label: item.label,
          x: item.x,
          y: item.y,
        };
        this.emitEvent(pickedEv);
        return;
      }

      if (item.kind === 'medkit') {
        this.lootItems.splice(i, 1);
        this.addMedkit(playerId, item.medkitAmount ?? 1);
        const pickedEv: Omit<LootPickedEvent, 'eventId' | 'tick'> = {
          type: 'loot_picked',
          playerId,
          lootId: item.id,
          kind: item.kind,
          label: item.label,
          x: item.x,
          y: item.y,
        };
        this.emitEvent(pickedEv);
        return;
      }

      // Se for arma no chão e o jogador tiver ao menos um espaço livre (slot1 ou slot2), coleta ao passar por cima
      // (só troca automaticamente a arma em mãos se o jogador estiver atualmente usando a faca)
      if (item.kind === 'weapon' && item.weaponId && (!inv.slot1 || !inv.slot2)) {
        this.lootItems.splice(i, 1);
        const shouldAutoSelect = inv.activeSlot === 'knife';
        giveWeaponToInventory(inv, item.weaponId, item.magAmmo, shouldAutoSelect);
        syncPlayerInventorySnapshotFields(player, inv);
        const pickedEv: Omit<LootPickedEvent, 'eventId' | 'tick'> = {
          type: 'loot_picked',
          playerId,
          lootId: item.id,
          kind: item.kind,
          label: item.label,
          x: item.x,
          y: item.y,
        };
        this.emitEvent(pickedEv);
        return;
      }
    }
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
        emitRoundCompleted: (ev: Omit<RoundCompletedEvent, 'eventId' | 'tick'>) => {
          for (const p of playerList) {
            if (p.alive) {
              this.addResource(p.id, 'wood', BALANCE.SURVIVAL.WAVE_BONUS_WOOD);
              this.addResource(p.id, 'scrap', BALANCE.SURVIVAL.WAVE_BONUS_SCRAP);
            }
          }
          this.emitEvent(ev);
        },
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
        emitHordeCleared: (ev: Omit<HordeClearedEvent, 'eventId' | 'tick'>) => {
          for (const p of playerList) {
            if (p.alive) {
              this.addResource(p.id, 'wood', BALANCE.SURVIVAL.WAVE_BONUS_WOOD);
              this.addResource(p.id, 'scrap', BALANCE.SURVIVAL.WAVE_BONUS_SCRAP);
            }
          }
          this.emitEvent(ev);
        },
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

    // Concede recursos de sobrevivência para a dupla durante abates (Etapa 4)
    const awardScrap =
      zombie.kind === 'brute' || zombie.kind === 'tank' || this.totalKills % 3 === 0;
    const awardWood = this.totalKills % 2 === 0;
    if (awardScrap || awardWood) {
      for (const p of this.players.values()) {
        if (p.alive) {
          if (awardWood) {
            this.addResource(p.id, 'wood', 1);
          }
          if (awardScrap) {
            this.addResource(p.id, 'scrap', 1);
          }
        }
      }
    }
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
