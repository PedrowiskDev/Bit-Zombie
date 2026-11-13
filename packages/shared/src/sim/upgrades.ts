import { BALANCE } from '../config/balance.js';
import type { SeededRng } from '../math/rng.js';
import type { LevelUpBonusKind, WeaponId } from '../types/protocol.js';
import { getWeaponDefinition } from './weapons.js';

/**
 * Identificadores de upgrades do catálogo (Fase 1 + Fase 2 + Etapa 3).
 */
export type UpgradeId =
  | 'pistol_damage_boost'
  | 'pistol_firerate_boost'
  | 'pistol_range_boost'
  | 'pistol_proj_speed_boost'
  | 'pistol_multishot_boost'
  | 'pistol_pierce_boost'
  | 'player_move_speed_boost'
  | 'player_max_hp_boost';

export type UpgradeCategory = 'weapon' | 'survivability' | 'mobility';

export interface UpgradeEffectModifiers {
  damageMultiplier?: number;
  fireRateMultiplier?: number;
  rangeBonusPx?: number;
  projectileSpeedMultiplier?: number;
  extraProjectiles?: number;
  extraPierce?: number;
  moveSpeedMultiplier?: number;
  maxHpBonus?: number;
  instantHealHp?: number;
  meleeRangeBonusRatio?: number;
  meleeArcBonusDeg?: number;
  meleeDamageMultiplier?: number;
  meleeKnockbackBonusRatio?: number;
}

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  description: string;
  category: UpgradeCategory;
  maxStacks: number;
  modifiersPerStack: UpgradeEffectModifiers;
}

export interface AppliedUpgradeStack {
  upgradeId: UpgradeId;
  stacks: number;
}

/**
 * Estrutura de escolha pendente de upgrade por jogador na Fase 2.
 */
export interface PendingUpgradeOffer {
  levelReached: number;
  options: UpgradeId[];
  selectedUpgradeId: UpgradeId | null;
  remainingMs?: number;
}

export interface EffectiveWeaponStats {
  weaponId: WeaponId;
  damage: number;
  fireRatePerSec: number;
  rangePx: number;
  projectileSpeedPxPerSec: number;
  damageMultiplier: number;
  fireRateMultiplier: number;
  projectileCount: number;
  pierceCount: number;
  moveSpeedPxPerSec: number;
  maxHpBonus: number;
  arcDeg: number;
  windupMs: number;
  activeMs: number;
  recoveryMs: number;
  knockbackPx: number;
  reloadSpeedMultiplier: number;
}

/**
 * Catálogo completo de upgrades revisado na Etapa 3 para beneficiar tanto quem está
 * apenas com Faca/Bastão quanto quem utiliza Pistola, Escopeta, Submetralhadora ou Rifle.
 */
export const UPGRADE_CATALOG: Readonly<Record<UpgradeId, UpgradeDefinition>> = {
  pistol_damage_boost: {
    id: 'pistol_damage_boost',
    name: 'Lâmina Afiada & Ponta Oca',
    description: '+10% de dano em golpes de faca/bastão e em todas as armas de fogo.',
    category: 'weapon',
    maxStacks: 10,
    modifiersPerStack: {
      damageMultiplier: BALANCE.XP.AUTO_DAMAGE_BONUS_PER_LEVEL,
    },
  },
  pistol_firerate_boost: {
    id: 'pistol_firerate_boost',
    name: 'Reflexo & Gatilho Aliviado',
    description: '+8% de velocidade de golpe, cadência de tiro e velocidade de recarga.',
    category: 'weapon',
    maxStacks: 10,
    modifiersPerStack: {
      fireRateMultiplier: BALANCE.XP.AUTO_FIRE_RATE_BONUS_PER_LEVEL,
    },
  },
  pistol_range_boost: {
    id: 'pistol_range_boost',
    name: 'Envergadura & Cano Alongado',
    description: '+35 px de alcance nas armas de fogo; +16% de alcance e +10° de arco na faca/bastão.',
    category: 'weapon',
    maxStacks: 5,
    modifiersPerStack: {
      rangeBonusPx: 35,
      meleeRangeBonusRatio: 0.16,
      meleeArcBonusDeg: 10,
    },
  },
  pistol_proj_speed_boost: {
    id: 'pistol_proj_speed_boost',
    name: 'Impulso Cinético +P',
    description: '+12% de velocidade de projétil e +20% de empurrão em golpes e disparos.',
    category: 'weapon',
    maxStacks: 5,
    modifiersPerStack: {
      projectileSpeedMultiplier: 0.12,
      meleeKnockbackBonusRatio: 0.2,
    },
  },
  pistol_multishot_boost: {
    id: 'pistol_multishot_boost',
    name: 'Golpe Amplo & Leque Tático',
    description: '+1 projétil por disparo; na faca/bastão amplia o arco em +25° e +20% de dano.',
    category: 'weapon',
    maxStacks: 2,
    modifiersPerStack: {
      extraProjectiles: 1,
      meleeArcBonusDeg: 25,
      meleeDamageMultiplier: 0.2,
    },
  },
  pistol_pierce_boost: {
    id: 'pistol_pierce_boost',
    name: 'Impacto Perfurante FMJ',
    description: 'Projéteis atravessam +1 alvo; na faca/bastão concede +45% de empurrão e +15% de dano.',
    category: 'weapon',
    maxStacks: 3,
    modifiersPerStack: {
      extraPierce: 1,
      meleeKnockbackBonusRatio: 0.45,
      meleeDamageMultiplier: 0.15,
    },
  },
  player_move_speed_boost: {
    id: 'player_move_speed_boost',
    name: 'Botas Táticas Leves',
    description: '+8% de velocidade de movimento.',
    category: 'mobility',
    maxStacks: 5,
    modifiersPerStack: {
      moveSpeedMultiplier: 0.08,
    },
  },
  player_max_hp_boost: {
    id: 'player_max_hp_boost',
    name: 'Colete de Kevlar + Kit Médico',
    description: '+20 de vida máxima e cura +25 HP imediatamente.',
    category: 'survivability',
    maxStacks: 5,
    modifiersPerStack: {
      maxHpBonus: 20,
      instantHealHp: 25,
    },
  },
};

export const ALL_UPGRADE_IDS: readonly UpgradeId[] = Object.keys(
  UPGRADE_CATALOG
) as UpgradeId[];

export function isValidUpgradeId(raw: unknown): raw is UpgradeId {
  return typeof raw === 'string' && raw in UPGRADE_CATALOG;
}

/**
 * Sorteia deterministicamente até `count` opções distintas de upgrade
 * que ainda não atingiram o limite `maxStacks` para o jogador.
 */
export function rollUpgradeOptionsForPlayer(
  rng: SeededRng,
  currentStacks: readonly AppliedUpgradeStack[] = [],
  count: number = BALANCE.XP.UPGRADE_OPTIONS_COUNT
): UpgradeId[] {
  const stackMap = new Map<UpgradeId, number>();
  for (const s of currentStacks) {
    stackMap.set(s.upgradeId, (stackMap.get(s.upgradeId) ?? 0) + s.stacks);
  }

  const eligible = ALL_UPGRADE_IDS.filter((id) => {
    const def = UPGRADE_CATALOG[id];
    const current = stackMap.get(id) ?? 0;
    return current < def.maxStacks;
  });

  const pool = eligible.length > 0 ? [...eligible] : [...ALL_UPGRADE_IDS];
  const chosen: UpgradeId[] = [];
  const targetCount = Math.min(count, pool.length);

  for (let i = 0; i < targetCount; i += 1) {
    const idx = Math.floor(rng.nextFloat() * pool.length);
    const picked = pool.splice(idx, 1)[0];
    if (picked) {
      chosen.push(picked);
    }
  }

  return chosen;
}

/**
 * Determina qual bônus automático da Fase 1 é concedido ao alcançar `newLevel` (para `newLevel >= 2`):
 * - Níveis pares (2, 4, 6...): +10% de dano (`damage`)
 * - Níveis ímpares (3, 5, 7...): +8% de cadência (`fire_rate`)
 */
export function getAutoBonusForLevel(newLevel: number): {
  bonusKind: LevelUpBonusKind;
  upgradeId: UpgradeId;
  bonusLabel: string;
} {
  if (newLevel % 2 === 0) {
    return {
      bonusKind: 'damage',
      upgradeId: 'pistol_damage_boost',
      bonusLabel: '+10% Dano de Armas',
    };
  }
  return {
    bonusKind: 'fire_rate',
    upgradeId: 'pistol_firerate_boost',
    bonusLabel: '+8% Cadência & Golpe',
  };
}

/**
 * Constrói a lista de stacks de upgrades automáticos acumulados até o nível `level` na Fase 1,
 * permitindo também combinar upgrades extras escolhidos na Fase 2.
 */
export function getAutomaticUpgradesForLevel(level: number): AppliedUpgradeStack[] {
  const safeLevel = Math.max(1, Math.floor(level));
  let damageStacks = 0;
  let fireRateStacks = 0;

  for (let lv = 2; lv <= safeLevel; lv += 1) {
    if (lv % 2 === 0) {
      damageStacks += 1;
    } else {
      fireRateStacks += 1;
    }
  }

  const stacks: AppliedUpgradeStack[] = [];
  if (damageStacks > 0) {
    stacks.push({ upgradeId: 'pistol_damage_boost', stacks: damageStacks });
  }
  if (fireRateStacks > 0) {
    stacks.push({ upgradeId: 'pistol_firerate_boost', stacks: fireRateStacks });
  }
  return stacks;
}

/**
 * Calcula os atributos efetivos da arma (`weaponId`, padrão `'pistol'`) e do jogador
 * a partir do nível atual e dos upgrades aplicados, integrando efeitos para Faca/Bastão
 * e Armas de Fogo (Etapa 3).
 */
export function computeEffectiveWeaponStats(
  level: number,
  extraUpgrades: readonly AppliedUpgradeStack[] = [],
  weaponId: WeaponId = 'pistol'
): EffectiveWeaponStats {
  const autoUpgrades = getAutomaticUpgradesForLevel(level);
  const mergedMap = new Map<UpgradeId, number>();

  for (const item of [...autoUpgrades, ...extraUpgrades]) {
    if (item.stacks > 0) {
      mergedMap.set(item.upgradeId, (mergedMap.get(item.upgradeId) ?? 0) + item.stacks);
    }
  }

  let damageBonusPct = 0;
  let fireRateBonusPct = 0;
  let rangeBonusPx = 0;
  let projSpeedBonusPct = 0;
  let extraProjectiles = 0;
  let extraPierce = 0;
  let moveSpeedBonusPct = 0;
  let maxHpBonus = 0;
  let meleeRangeBonusRatio = 0;
  let meleeArcBonusDeg = 0;
  let meleeDamageExtraPct = 0;
  let meleeKnockbackBonusRatio = 0;

  for (const [upgradeId, rawStacks] of mergedMap.entries()) {
    const def = UPGRADE_CATALOG[upgradeId];
    if (!def || rawStacks <= 0) {
      continue;
    }
    const clampedStacks = Math.min(def.maxStacks, rawStacks);
    if (def.modifiersPerStack.damageMultiplier) {
      damageBonusPct += def.modifiersPerStack.damageMultiplier * clampedStacks;
    }
    if (def.modifiersPerStack.fireRateMultiplier) {
      fireRateBonusPct += def.modifiersPerStack.fireRateMultiplier * clampedStacks;
    }
    if (def.modifiersPerStack.rangeBonusPx) {
      rangeBonusPx += def.modifiersPerStack.rangeBonusPx * clampedStacks;
    }
    if (def.modifiersPerStack.projectileSpeedMultiplier) {
      projSpeedBonusPct += def.modifiersPerStack.projectileSpeedMultiplier * clampedStacks;
    }
    if (def.modifiersPerStack.extraProjectiles) {
      extraProjectiles += def.modifiersPerStack.extraProjectiles * clampedStacks;
    }
    if (def.modifiersPerStack.extraPierce) {
      extraPierce += def.modifiersPerStack.extraPierce * clampedStacks;
    }
    if (def.modifiersPerStack.moveSpeedMultiplier) {
      moveSpeedBonusPct += def.modifiersPerStack.moveSpeedMultiplier * clampedStacks;
    }
    if (def.modifiersPerStack.maxHpBonus) {
      maxHpBonus += def.modifiersPerStack.maxHpBonus * clampedStacks;
    }
    if (def.modifiersPerStack.meleeRangeBonusRatio) {
      meleeRangeBonusRatio += def.modifiersPerStack.meleeRangeBonusRatio * clampedStacks;
    }
    if (def.modifiersPerStack.meleeArcBonusDeg) {
      meleeArcBonusDeg += def.modifiersPerStack.meleeArcBonusDeg * clampedStacks;
    }
    if (def.modifiersPerStack.meleeDamageMultiplier) {
      meleeDamageExtraPct += def.modifiersPerStack.meleeDamageMultiplier * clampedStacks;
    }
    if (def.modifiersPerStack.meleeKnockbackBonusRatio) {
      meleeKnockbackBonusRatio +=
        def.modifiersPerStack.meleeKnockbackBonusRatio * clampedStacks;
    }
  }

  const weaponDef = getWeaponDefinition(weaponId);
  const isMelee = weaponDef.category === 'melee';
  const totalDamagePct = isMelee
    ? damageBonusPct + meleeDamageExtraPct
    : damageBonusPct;

  const damageMultiplier = Number((1 + totalDamagePct).toFixed(4));
  const fireRateMultiplier = Number((1 + fireRateBonusPct).toFixed(4));

  const effectiveRangePx = isMelee
    ? Math.round(weaponDef.rangePx * (1 + meleeRangeBonusRatio))
    : weaponDef.rangePx + rangeBonusPx;

  const effectiveArcDeg = isMelee
    ? Math.min(200, weaponDef.arcDeg + meleeArcBonusDeg)
    : 0;

  const effectiveWindupMs = isMelee
    ? Math.max(25, Math.round(weaponDef.windupMs / fireRateMultiplier))
    : 0;
  const effectiveActiveMs = isMelee
    ? Math.max(35, Math.round(weaponDef.activeMs / fireRateMultiplier))
    : 0;
  const effectiveRecoveryMs = isMelee
    ? Math.max(50, Math.round(weaponDef.recoveryMs / fireRateMultiplier))
    : 0;

  const effectiveKnockbackPx = Math.round(
    weaponDef.knockbackPx * (1 + meleeKnockbackBonusRatio)
  );

  return {
    weaponId,
    damage: Number((weaponDef.damage * damageMultiplier).toFixed(2)),
    fireRatePerSec: Number((weaponDef.fireRatePerSec * fireRateMultiplier).toFixed(2)),
    rangePx: effectiveRangePx,
    projectileSpeedPxPerSec: isMelee
      ? 0
      : Math.round(weaponDef.projectileSpeedPxPerSec * (1 + projSpeedBonusPct)),
    damageMultiplier,
    fireRateMultiplier,
    projectileCount: isMelee ? 1 : weaponDef.pellets + extraProjectiles,
    pierceCount: isMelee ? 0 : weaponDef.pierceCount + extraPierce,
    moveSpeedPxPerSec: Number(
      (BALANCE.PLAYER.SPEED_PX_PER_SEC * (1 + moveSpeedBonusPct)).toFixed(2)
    ),
    maxHpBonus,
    arcDeg: effectiveArcDeg,
    windupMs: effectiveWindupMs,
    activeMs: effectiveActiveMs,
    recoveryMs: effectiveRecoveryMs,
    knockbackPx: effectiveKnockbackPx,
    reloadSpeedMultiplier: fireRateMultiplier,
  };
}

