import { BALANCE } from '../config/balance.js';
import { SeededRng } from '../math/rng.js';
import { clampPositionToArena } from '../math/vec2.js';
import type {
  AmmoType,
  EquippedSlotId,
  LootContainerKind,
  LootContainerSnapshot,
  MeleeAttackPhase,
  PlayerStateSnapshot,
  PropData,
  WeaponCategory,
  WeaponId,
  WorldLootItemSnapshot,
} from '../types/protocol.js';

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  role: string;
  category: WeaponCategory;
  damage: number;
  fireRatePerSec: number;
  rangePx: number;
  arcDeg: number;
  windupMs: number;
  activeMs: number;
  recoveryMs: number;
  knockbackPx: number;
  pellets: number;
  spreadDeg: number;
  pierceCount: number;
  projectileSpeedPxPerSec: number;
  projectileRadius: number;
  ammoType: AmmoType;
  magSize: number;
  reloadMs: number;
  noiseRadiusPx: number;
}

export const WEAPON_CATALOG: Readonly<Record<WeaponId, WeaponDefinition>> = {
  knife: {
    id: 'knife',
    name: BALANCE.WEAPONS.KNIFE.NAME,
    role: BALANCE.WEAPONS.KNIFE.ROLE,
    category: 'melee',
    damage: BALANCE.WEAPONS.KNIFE.DAMAGE,
    fireRatePerSec: BALANCE.WEAPONS.KNIFE.FIRE_RATE_PER_SEC,
    rangePx: BALANCE.WEAPONS.KNIFE.RANGE_PX,
    arcDeg: BALANCE.WEAPONS.KNIFE.ARC_DEG,
    windupMs: BALANCE.WEAPONS.KNIFE.WINDUP_MS,
    activeMs: BALANCE.WEAPONS.KNIFE.ACTIVE_MS,
    recoveryMs: BALANCE.WEAPONS.KNIFE.RECOVERY_MS,
    knockbackPx: BALANCE.WEAPONS.KNIFE.KNOCKBACK_PX,
    pellets: BALANCE.WEAPONS.KNIFE.PELLETS,
    spreadDeg: BALANCE.WEAPONS.KNIFE.SPREAD_DEG,
    pierceCount: BALANCE.WEAPONS.KNIFE.PIERCE_COUNT,
    projectileSpeedPxPerSec: BALANCE.WEAPONS.KNIFE.PROJECTILE_SPEED_PX_PER_SEC,
    projectileRadius: BALANCE.WEAPONS.KNIFE.PROJECTILE_RADIUS,
    ammoType: 'none',
    magSize: 0,
    reloadMs: 0,
    noiseRadiusPx: BALANCE.WEAPONS.KNIFE.NOISE_RADIUS_PX,
  },
  bat: {
    id: 'bat',
    name: BALANCE.WEAPONS.BAT.NAME,
    role: BALANCE.WEAPONS.BAT.ROLE,
    category: 'melee',
    damage: BALANCE.WEAPONS.BAT.DAMAGE,
    fireRatePerSec: BALANCE.WEAPONS.BAT.FIRE_RATE_PER_SEC,
    rangePx: BALANCE.WEAPONS.BAT.RANGE_PX,
    arcDeg: BALANCE.WEAPONS.BAT.ARC_DEG,
    windupMs: BALANCE.WEAPONS.BAT.WINDUP_MS,
    activeMs: BALANCE.WEAPONS.BAT.ACTIVE_MS,
    recoveryMs: BALANCE.WEAPONS.BAT.RECOVERY_MS,
    knockbackPx: BALANCE.WEAPONS.BAT.KNOCKBACK_PX,
    pellets: BALANCE.WEAPONS.BAT.PELLETS,
    spreadDeg: BALANCE.WEAPONS.BAT.SPREAD_DEG,
    pierceCount: BALANCE.WEAPONS.BAT.PIERCE_COUNT,
    projectileSpeedPxPerSec: BALANCE.WEAPONS.BAT.PROJECTILE_SPEED_PX_PER_SEC,
    projectileRadius: BALANCE.WEAPONS.BAT.PROJECTILE_RADIUS,
    ammoType: 'none',
    magSize: 0,
    reloadMs: 0,
    noiseRadiusPx: BALANCE.WEAPONS.BAT.NOISE_RADIUS_PX,
  },
  pistol: {
    id: 'pistol',
    name: BALANCE.WEAPONS.PISTOL.NAME,
    role: BALANCE.WEAPONS.PISTOL.ROLE,
    category: 'firearm',
    damage: BALANCE.WEAPONS.PISTOL.DAMAGE,
    fireRatePerSec: BALANCE.WEAPONS.PISTOL.FIRE_RATE_PER_SEC,
    rangePx: BALANCE.WEAPONS.PISTOL.RANGE_PX,
    arcDeg: 0,
    windupMs: 0,
    activeMs: 0,
    recoveryMs: 0,
    knockbackPx: BALANCE.WEAPONS.PISTOL.KNOCKBACK_PX,
    pellets: BALANCE.WEAPONS.PISTOL.PELLETS,
    spreadDeg: BALANCE.WEAPONS.PISTOL.SPREAD_DEG,
    pierceCount: BALANCE.WEAPONS.PISTOL.PIERCE_COUNT,
    projectileSpeedPxPerSec: BALANCE.WEAPONS.PISTOL.PROJECTILE_SPEED_PX_PER_SEC,
    projectileRadius: BALANCE.WEAPONS.PISTOL.PROJECTILE_RADIUS,
    ammoType: 'light',
    magSize: BALANCE.WEAPONS.PISTOL.MAG_SIZE,
    reloadMs: BALANCE.WEAPONS.PISTOL.RELOAD_MS,
    noiseRadiusPx: BALANCE.WEAPONS.PISTOL.NOISE_RADIUS_PX,
  },
  shotgun: {
    id: 'shotgun',
    name: BALANCE.WEAPONS.SHOTGUN.NAME,
    role: BALANCE.WEAPONS.SHOTGUN.ROLE,
    category: 'firearm',
    damage: BALANCE.WEAPONS.SHOTGUN.DAMAGE,
    fireRatePerSec: BALANCE.WEAPONS.SHOTGUN.FIRE_RATE_PER_SEC,
    rangePx: BALANCE.WEAPONS.SHOTGUN.RANGE_PX,
    arcDeg: 0,
    windupMs: 0,
    activeMs: 0,
    recoveryMs: 0,
    knockbackPx: BALANCE.WEAPONS.SHOTGUN.KNOCKBACK_PX,
    pellets: BALANCE.WEAPONS.SHOTGUN.PELLETS,
    spreadDeg: BALANCE.WEAPONS.SHOTGUN.SPREAD_DEG,
    pierceCount: BALANCE.WEAPONS.SHOTGUN.PIERCE_COUNT,
    projectileSpeedPxPerSec: BALANCE.WEAPONS.SHOTGUN.PROJECTILE_SPEED_PX_PER_SEC,
    projectileRadius: BALANCE.WEAPONS.SHOTGUN.PROJECTILE_RADIUS,
    ammoType: 'shells',
    magSize: BALANCE.WEAPONS.SHOTGUN.MAG_SIZE,
    reloadMs: BALANCE.WEAPONS.SHOTGUN.RELOAD_MS,
    noiseRadiusPx: BALANCE.WEAPONS.SHOTGUN.NOISE_RADIUS_PX,
  },
  smg: {
    id: 'smg',
    name: BALANCE.WEAPONS.SMG.NAME,
    role: BALANCE.WEAPONS.SMG.ROLE,
    category: 'firearm',
    damage: BALANCE.WEAPONS.SMG.DAMAGE,
    fireRatePerSec: BALANCE.WEAPONS.SMG.FIRE_RATE_PER_SEC,
    rangePx: BALANCE.WEAPONS.SMG.RANGE_PX,
    arcDeg: 0,
    windupMs: 0,
    activeMs: 0,
    recoveryMs: 0,
    knockbackPx: BALANCE.WEAPONS.SMG.KNOCKBACK_PX,
    pellets: BALANCE.WEAPONS.SMG.PELLETS,
    spreadDeg: BALANCE.WEAPONS.SMG.SPREAD_DEG,
    pierceCount: BALANCE.WEAPONS.SMG.PIERCE_COUNT,
    projectileSpeedPxPerSec: BALANCE.WEAPONS.SMG.PROJECTILE_SPEED_PX_PER_SEC,
    projectileRadius: BALANCE.WEAPONS.SMG.PROJECTILE_RADIUS,
    ammoType: 'light',
    magSize: BALANCE.WEAPONS.SMG.MAG_SIZE,
    reloadMs: BALANCE.WEAPONS.SMG.RELOAD_MS,
    noiseRadiusPx: BALANCE.WEAPONS.SMG.NOISE_RADIUS_PX,
  },
  rifle: {
    id: 'rifle',
    name: BALANCE.WEAPONS.RIFLE.NAME,
    role: BALANCE.WEAPONS.RIFLE.ROLE,
    category: 'firearm',
    damage: BALANCE.WEAPONS.RIFLE.DAMAGE,
    fireRatePerSec: BALANCE.WEAPONS.RIFLE.FIRE_RATE_PER_SEC,
    rangePx: BALANCE.WEAPONS.RIFLE.RANGE_PX,
    arcDeg: 0,
    windupMs: 0,
    activeMs: 0,
    recoveryMs: 0,
    knockbackPx: BALANCE.WEAPONS.RIFLE.KNOCKBACK_PX,
    pellets: BALANCE.WEAPONS.RIFLE.PELLETS,
    spreadDeg: BALANCE.WEAPONS.RIFLE.SPREAD_DEG,
    pierceCount: BALANCE.WEAPONS.RIFLE.PIERCE_COUNT,
    projectileSpeedPxPerSec: BALANCE.WEAPONS.RIFLE.PROJECTILE_SPEED_PX_PER_SEC,
    projectileRadius: BALANCE.WEAPONS.RIFLE.PROJECTILE_RADIUS,
    ammoType: 'heavy',
    magSize: BALANCE.WEAPONS.RIFLE.MAG_SIZE,
    reloadMs: BALANCE.WEAPONS.RIFLE.RELOAD_MS,
    noiseRadiusPx: BALANCE.WEAPONS.RIFLE.NOISE_RADIUS_PX,
  },
};

export const ALL_WEAPON_IDS: readonly WeaponId[] = [
  'knife',
  'bat',
  'pistol',
  'shotgun',
  'smg',
  'rifle',
];

export const FINDABLE_WEAPON_IDS: readonly Exclude<WeaponId, 'knife'>[] = [
  'bat',
  'pistol',
  'shotgun',
  'smg',
  'rifle',
];

export function isValidWeaponId(raw: unknown): raw is WeaponId {
  return typeof raw === 'string' && raw in WEAPON_CATALOG;
}

export function getWeaponDefinition(weaponId: WeaponId): WeaponDefinition {
  return WEAPON_CATALOG[weaponId] ?? WEAPON_CATALOG.knife;
}

export function getAmmoLabel(ammoType: AmmoType): string {
  switch (ammoType) {
    case 'light':
      return 'Munição Leve (9mm)';
    case 'shells':
      return 'Cartuchos (Cal. 12)';
    case 'heavy':
      return 'Munição Pesada (7.62)';
    default:
      return 'Sem Munição';
  }
}

export interface PlayerWeaponSlotState {
  weaponId: WeaponId;
  magAmmo: number;
}

export interface MeleeSwingState {
  weaponId: WeaponId;
  phase: Exclude<MeleeAttackPhase, 'idle'>;
  phaseRemainingMs: number;
  windupMs: number;
  activeMs: number;
  recoveryMs: number;
  angle: number;
  arcDeg: number;
  rangePx: number;
  damage: number;
  knockbackPx: number;
  hitZombieIds: Set<number>;
}

export interface PlayerWeaponInventory {
  activeSlot: EquippedSlotId;
  slot1: PlayerWeaponSlotState | null;
  slot2: PlayerWeaponSlotState | null;
  ammoReserve: {
    light: number;
    shells: number;
    heavy: number;
  };
  reloadRemainingMs: number;
  reloadTotalMs: number;
  reloadingSlot: 'slot1' | 'slot2' | null;
  meleeSwing: MeleeSwingState | null;
}

export interface InternalLootContainer extends LootContainerSnapshot {
  contents: Array<
    | {
        kind: 'weapon';
        weaponId: Exclude<WeaponId, 'knife'>;
        magAmmo: number;
        label: string;
      }
    | {
        kind: 'ammo';
        ammoType: Exclude<AmmoType, 'none'>;
        ammoAmount: number;
        label: string;
      }
  >;
}

export function createInitialPlayerInventory(
  startingWeapon: WeaponId = 'knife'
): PlayerWeaponInventory {
  const inv: PlayerWeaponInventory = {
    activeSlot: 'knife',
    slot1: null,
    slot2: null,
    ammoReserve: {
      light: BALANCE.LOOT.STARTING_RESERVE.LIGHT,
      shells: BALANCE.LOOT.STARTING_RESERVE.SHELLS,
      heavy: BALANCE.LOOT.STARTING_RESERVE.HEAVY,
    },
    reloadRemainingMs: 0,
    reloadTotalMs: 0,
    reloadingSlot: null,
    meleeSwing: null,
  };

  if (startingWeapon !== 'knife') {
    const def = getWeaponDefinition(startingWeapon);
    inv.slot1 = {
      weaponId: startingWeapon,
      magAmmo: def.magSize,
    };
    inv.activeSlot = 'slot1';
    if (def.ammoType === 'light') {
      inv.ammoReserve.light = Math.max(inv.ammoReserve.light, 120);
    } else if (def.ammoType === 'shells') {
      inv.ammoReserve.shells = Math.max(inv.ammoReserve.shells, 48);
    } else if (def.ammoType === 'heavy') {
      inv.ammoReserve.heavy = Math.max(inv.ammoReserve.heavy, 48);
    }
  }

  return inv;
}

export function getActiveSlotWeaponState(
  inv: PlayerWeaponInventory
): PlayerWeaponSlotState | null {
  if (inv.activeSlot === 'slot1') {
    return inv.slot1;
  }
  if (inv.activeSlot === 'slot2') {
    return inv.slot2;
  }
  return null;
}

export function getActiveWeaponId(inv: PlayerWeaponInventory): WeaponId {
  if (inv.activeSlot === 'slot1' && inv.slot1) {
    return inv.slot1.weaponId;
  }
  if (inv.activeSlot === 'slot2' && inv.slot2) {
    return inv.slot2.weaponId;
  }
  return 'knife';
}

export function cancelReloadAndSwing(inv: PlayerWeaponInventory): void {
  inv.reloadRemainingMs = 0;
  inv.reloadTotalMs = 0;
  inv.reloadingSlot = null;
  inv.meleeSwing = null;
}

export function switchPlayerWeaponSlot(
  inv: PlayerWeaponInventory,
  targetSlot: EquippedSlotId
): boolean {
  if (targetSlot === 'knife') {
    if (inv.activeSlot === 'knife') {
      return false;
    }
    cancelReloadAndSwing(inv);
    inv.activeSlot = 'knife';
    return true;
  }

  if (targetSlot === 'slot1') {
    if (!inv.slot1 || inv.activeSlot === 'slot1') {
      return false;
    }
    cancelReloadAndSwing(inv);
    inv.activeSlot = 'slot1';
    return true;
  }

  if (targetSlot === 'slot2') {
    if (!inv.slot2 || inv.activeSlot === 'slot2') {
      return false;
    }
    cancelReloadAndSwing(inv);
    inv.activeSlot = 'slot2';
    return true;
  }

  return false;
}

export function startWeaponReload(
  inv: PlayerWeaponInventory,
  reloadSpeedMultiplier = 1
): boolean {
  if (inv.reloadRemainingMs > 0) {
    return false;
  }
  if (inv.activeSlot !== 'slot1' && inv.activeSlot !== 'slot2') {
    return false;
  }

  const slotState = inv.activeSlot === 'slot1' ? inv.slot1 : inv.slot2;
  if (!slotState) {
    return false;
  }

  const def = getWeaponDefinition(slotState.weaponId);
  if (def.category !== 'firearm' || def.ammoType === 'none' || def.magSize <= 0) {
    return false;
  }

  if (slotState.magAmmo >= def.magSize) {
    return false;
  }

  const reserveAvailable = inv.ammoReserve[def.ammoType] ?? 0;
  if (reserveAvailable <= 0) {
    return false;
  }

  const safeSpeed = Math.max(0.25, reloadSpeedMultiplier);
  const durationMs = Math.max(150, Math.round(def.reloadMs / safeSpeed));
  inv.reloadTotalMs = durationMs;
  inv.reloadRemainingMs = durationMs;
  inv.reloadingSlot = inv.activeSlot;
  inv.meleeSwing = null;
  return true;
}

export function stepWeaponReload(
  inv: PlayerWeaponInventory,
  dtMs: number
): boolean {
  if (inv.reloadRemainingMs <= 0 || !inv.reloadingSlot) {
    return false;
  }

  // Se trocou de slot durante a recarga, cancela
  if (inv.activeSlot !== inv.reloadingSlot) {
    inv.reloadRemainingMs = 0;
    inv.reloadTotalMs = 0;
    inv.reloadingSlot = null;
    return false;
  }

  inv.reloadRemainingMs = Math.max(0, inv.reloadRemainingMs - dtMs);
  if (inv.reloadRemainingMs > 0) {
    return false;
  }

  const slotState = inv.reloadingSlot === 'slot1' ? inv.slot1 : inv.slot2;
  inv.reloadTotalMs = 0;
  inv.reloadingSlot = null;

  if (!slotState) {
    return false;
  }

  const def = getWeaponDefinition(slotState.weaponId);
  if (def.category !== 'firearm' || def.ammoType === 'none') {
    return false;
  }

  const needed = Math.max(0, def.magSize - slotState.magAmmo);
  const available = inv.ammoReserve[def.ammoType] ?? 0;
  const loaded = Math.min(needed, available);
  if (loaded <= 0) {
    return false;
  }

  slotState.magAmmo += loaded;
  inv.ammoReserve[def.ammoType] = available - loaded;
  return true;
}

export function giveWeaponToInventory(
  inv: PlayerWeaponInventory,
  weaponId: WeaponId,
  magAmmo?: number,
  autoSelect = true
): {
  equippedSlot: 'slot1' | 'slot2' | null;
  droppedWeapon: PlayerWeaponSlotState | null;
} {
  if (weaponId === 'knife') {
    if (autoSelect) {
      inv.activeSlot = 'knife';
    }
    return { equippedSlot: null, droppedWeapon: null };
  }

  const def = getWeaponDefinition(weaponId);
  const resolvedMag =
    def.category === 'firearm'
      ? Math.max(0, Math.min(def.magSize, magAmmo ?? def.magSize))
      : 0;

  // Se o jogador já possui a mesma arma em um dos slots, recarrega/adiciona a munição à reserva
  if (inv.slot1?.weaponId === weaponId) {
    if (def.ammoType !== 'none' && resolvedMag > 0) {
      inv.ammoReserve[def.ammoType] += resolvedMag;
    }
    if (autoSelect) {
      inv.activeSlot = 'slot1';
    }
    return { equippedSlot: 'slot1', droppedWeapon: null };
  }
  if (inv.slot2?.weaponId === weaponId) {
    if (def.ammoType !== 'none' && resolvedMag > 0) {
      inv.ammoReserve[def.ammoType] += resolvedMag;
    }
    if (autoSelect) {
      inv.activeSlot = 'slot2';
    }
    return { equippedSlot: 'slot2', droppedWeapon: null };
  }

  const newSlotState: PlayerWeaponSlotState = {
    weaponId,
    magAmmo: resolvedMag,
  };

  if (!inv.slot1) {
    inv.slot1 = newSlotState;
    if (autoSelect) {
      cancelReloadAndSwing(inv);
      inv.activeSlot = 'slot1';
    }
    return { equippedSlot: 'slot1', droppedWeapon: null };
  }

  if (!inv.slot2) {
    inv.slot2 = newSlotState;
    if (autoSelect) {
      cancelReloadAndSwing(inv);
      inv.activeSlot = 'slot2';
    }
    return { equippedSlot: 'slot2', droppedWeapon: null };
  }

  // Ambos os slots estão ocupados: substitui o slot ativo (ou slot1 se estiver com a faca)
  const targetSlot: 'slot1' | 'slot2' =
    inv.activeSlot === 'slot2' ? 'slot2' : 'slot1';
  const dropped = targetSlot === 'slot1' ? inv.slot1 : inv.slot2;
  if (targetSlot === 'slot1') {
    inv.slot1 = newSlotState;
  } else {
    inv.slot2 = newSlotState;
  }
  if (autoSelect) {
    cancelReloadAndSwing(inv);
    inv.activeSlot = targetSlot;
  }
  return { equippedSlot: targetSlot, droppedWeapon: dropped };
}

export function addAmmoToInventory(
  inv: PlayerWeaponInventory,
  ammoType: Exclude<AmmoType, 'none'>,
  amount: number
): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }
  inv.ammoReserve[ammoType] = (inv.ammoReserve[ammoType] ?? 0) + Math.round(amount);
}

export function syncPlayerInventorySnapshotFields(
  player: PlayerStateSnapshot,
  inv: PlayerWeaponInventory
): void {
  // Se o slot ativo ficou vazio, volta para a faca
  if (inv.activeSlot === 'slot1' && !inv.slot1) {
    inv.activeSlot = 'knife';
  } else if (inv.activeSlot === 'slot2' && !inv.slot2) {
    inv.activeSlot = 'knife';
  }

  player.activeSlot = inv.activeSlot;
  player.activeWeaponId = getActiveWeaponId(inv);
  player.slot1WeaponId = inv.slot1 ? inv.slot1.weaponId : '';
  player.slot1MagAmmo = inv.slot1 ? inv.slot1.magAmmo : 0;
  player.slot2WeaponId = inv.slot2 ? inv.slot2.weaponId : '';
  player.slot2MagAmmo = inv.slot2 ? inv.slot2.magAmmo : 0;
  player.ammoLight = inv.ammoReserve.light;
  player.ammoShells = inv.ammoReserve.shells;
  player.ammoHeavy = inv.ammoReserve.heavy;
  player.reloadRemainingMs = inv.reloadRemainingMs;
  player.reloadTotalMs = inv.reloadTotalMs;
  player.meleePhase = inv.meleeSwing ? inv.meleeSwing.phase : 'idle';
}

function findSafeLootCoordinates(
  rawX: number,
  rawY: number,
  props: readonly PropData[],
  mapWidth: number,
  mapHeight: number,
  existingPositions: ReadonlyArray<{ x: number; y: number }> = [],
  minItemSpacingPx = 64
): { x: number; y: number } {
  const clamped = clampPositionToArena(rawX, rawY, 36, mapWidth, mapHeight);
  let x = clamped.x;
  let y = clamped.y;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    let conflictX: number | null = null;
    let conflictY: number | null = null;
    let pushOutDist = 64;

    for (let i = 0; i < props.length; i += 1) {
      const p = props[i];
      const propRadius =
        p.kind === 'car'
          ? 42 * p.scale
          : p.kind === 'crate'
            ? 24 * p.scale
            : 22 * p.scale;
      const minDist = propRadius + 24;
      if (Math.hypot(x - p.x, y - p.y) < minDist) {
        conflictX = p.x;
        conflictY = p.y;
        pushOutDist = minDist + 8;
        break;
      }
    }

    if (conflictX === null) {
      for (let i = 0; i < existingPositions.length; i += 1) {
        const other = existingPositions[i];
        if (Math.hypot(x - other.x, y - other.y) < minItemSpacingPx) {
          conflictX = other.x;
          conflictY = other.y;
          pushOutDist = minItemSpacingPx + 10;
          break;
        }
      }
    }

    if (conflictX === null || conflictY === null) {
      break;
    }

    const dx = x - conflictX;
    const dy = y - conflictY;
    const dist = Math.hypot(dx, dy) || 1;
    const nextClamped = clampPositionToArena(
      conflictX + (dx / dist) * pushOutDist,
      conflictY + (dy / dist) * pushOutDist,
      36,
      mapWidth,
      mapHeight
    );
    x = nextClamped.x;
    y = nextClamped.y;
  }

  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Gera deterministicamente a partir da `seed` os itens de loot no chão e os recipientes
 * pesquisáveis do mapa com distribuição escassa e equilibrada, mantendo uma oportunidade
 * inicial acessível perto do nascimento para quem começa apenas de faca (Etapa 3).
 */
export function generateWorldLootAndContainers(
  seed: number,
  props: readonly PropData[],
  mapWidth: number,
  mapHeight: number
): {
  lootItems: WorldLootItemSnapshot[];
  lootContainers: InternalLootContainer[];
  nextLootId: number;
} {
  const rng = new SeededRng((seed ^ 0x517cc1b7) >>> 0);
  const spawnX = BALANCE.PLAYER.SPAWN_X;
  const spawnY = BALANCE.PLAYER.SPAWN_Y;
  const lootItems: WorldLootItemSnapshot[] = [];
  const lootContainers: InternalLootContainer[] = [];
  const occupiedPositions: Array<{ x: number; y: number }> = [];
  let nextId = 1;

  // 1. Equipamento inicial enxuto ao redor da área de nascimento (1 Bastão + 1 Pistola em direções distintas)
  const starterWeapons: Array<{
    weaponId: Exclude<WeaponId, 'knife'>;
    angleRad: number;
    distPx: number;
  }> = [
    { weaponId: 'bat', angleRad: -0.78, distPx: 135 },
    { weaponId: 'pistol', angleRad: 0.42, distPx: 155 },
  ];

  for (const sw of starterWeapons) {
    const def = getWeaponDefinition(sw.weaponId);
    const pos = findSafeLootCoordinates(
      spawnX + Math.cos(sw.angleRad) * sw.distPx,
      spawnY + Math.sin(sw.angleRad) * sw.distPx,
      props,
      mapWidth,
      mapHeight,
      occupiedPositions,
      90
    );
    occupiedPositions.push(pos);
    lootItems.push({
      id: nextId++,
      kind: 'weapon',
      x: pos.x,
      y: pos.y,
      weaponId: sw.weaponId,
      magAmmo: def.magSize,
      label: def.name,
    });
  }

  // 2. Itens escassos distribuídos pelo mapa (exigindo exploração para achar escopeta, SMG, rifle e munição)
  const ammoTypes: Array<Exclude<AmmoType, 'none'>> = ['light', 'shells', 'heavy'];
  for (let i = 0; i < BALANCE.LOOT.WORLD_GROUND_ITEMS_COUNT; i += 1) {
    const angle = rng.nextFloat() * Math.PI * 2;
    const dist = 340 + rng.nextFloat() * 1380;
    const pos = findSafeLootCoordinates(
      spawnX + Math.cos(angle) * dist,
      spawnY + Math.sin(angle) * dist,
      props,
      mapWidth,
      mapHeight,
      occupiedPositions,
      210
    );
    occupiedPositions.push(pos);

    if (i % 3 === 0) {
      const weaponId =
        FINDABLE_WEAPON_IDS[Math.floor(rng.nextFloat() * FINDABLE_WEAPON_IDS.length)] ??
        'pistol';
      const def = getWeaponDefinition(weaponId);
      lootItems.push({
        id: nextId++,
        kind: 'weapon',
        x: pos.x,
        y: pos.y,
        weaponId,
        magAmmo: def.magSize,
        label: def.name,
      });
    } else {
      const ammoType =
        ammoTypes[Math.floor(rng.nextFloat() * ammoTypes.length)] ?? 'light';
      const amount =
        ammoType === 'light'
          ? BALANCE.LOOT.AMMO_PACK_AMOUNT.LIGHT
          : ammoType === 'shells'
            ? BALANCE.LOOT.AMMO_PACK_AMOUNT.SHELLS
            : BALANCE.LOOT.AMMO_PACK_AMOUNT.HEAVY;
      lootItems.push({
        id: nextId++,
        kind: 'ammo',
        x: pos.x,
        y: pos.y,
        ammoType,
        ammoAmount: amount,
        label: `${getAmmoLabel(ammoType)} (+${amount})`,
      });
    }
  }

  // 3. Recipientes pesquisáveis escassos (1 próximo à área inicial + restantes espalhados pelo mapa)
  const containerKinds: LootContainerKind[] = [
    'weapon_case',
    'supply_crate',
    'ammo_box',
  ];
  for (let i = 0; i < BALANCE.LOOT.WORLD_CONTAINERS_COUNT; i += 1) {
    const isNearSpawn = i === 0;
    const angle = isNearSpawn ? 1.75 : rng.nextFloat() * Math.PI * 2;
    const dist = isNearSpawn ? 175 : 380 + rng.nextFloat() * 1360;
    const pos = findSafeLootCoordinates(
      spawnX + Math.cos(angle) * dist,
      spawnY + Math.sin(angle) * dist,
      props,
      mapWidth,
      mapHeight,
      occupiedPositions,
      220
    );
    occupiedPositions.push(pos);

    const kind =
      containerKinds[i % containerKinds.length] ?? 'supply_crate';
    const label =
      kind === 'weapon_case'
        ? 'Maleta Tática de Armas'
        : kind === 'ammo_box'
          ? 'Caixa de Munição Militar'
          : 'Caixote de Suprimentos';

    const weaponId =
      FINDABLE_WEAPON_IDS[Math.floor(rng.nextFloat() * FINDABLE_WEAPON_IDS.length)] ??
      'pistol';
    const def = getWeaponDefinition(weaponId);
    const ammoType =
      ammoTypes[Math.floor(rng.nextFloat() * ammoTypes.length)] ?? 'light';
    const ammoAmount =
      ammoType === 'light'
        ? BALANCE.LOOT.AMMO_PACK_AMOUNT.LIGHT
        : ammoType === 'shells'
          ? BALANCE.LOOT.AMMO_PACK_AMOUNT.SHELLS
          : BALANCE.LOOT.AMMO_PACK_AMOUNT.HEAVY;

    const contents: InternalLootContainer['contents'] =
      kind === 'weapon_case'
        ? [
            {
              kind: 'weapon',
              weaponId,
              magAmmo: def.magSize,
              label: def.name,
            },
            {
              kind: 'ammo',
              ammoType: def.ammoType === 'none' ? 'light' : def.ammoType,
              ammoAmount,
              label: `${getAmmoLabel(def.ammoType === 'none' ? 'light' : def.ammoType)} (+${ammoAmount})`,
            },
          ]
        : kind === 'ammo_box'
          ? [
              {
                kind: 'ammo',
                ammoType,
                ammoAmount: Math.round(ammoAmount * 1.5),
                label: `${getAmmoLabel(ammoType)} (+${Math.round(ammoAmount * 1.5)})`,
              },
            ]
          : [
              {
                kind: 'weapon',
                weaponId,
                magAmmo: def.magSize,
                label: def.name,
              },
              {
                kind: 'ammo',
                ammoType,
                ammoAmount,
                label: `${getAmmoLabel(ammoType)} (+${ammoAmount})`,
              },
            ];

    lootContainers.push({
      id: nextId++,
      kind,
      x: pos.x,
      y: pos.y,
      opened: false,
      label,
      contents,
    });
  }

  return {
    lootItems,
    lootContainers,
    nextLootId: nextId,
  };
}

