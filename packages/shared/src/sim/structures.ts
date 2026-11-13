import { BALANCE } from '../config/balance.js';
import { clampPositionToArena } from '../math/vec2.js';
import type {
  BuildableStructureSnapshot,
  PlayerStateSnapshot,
  StructureDamagedEvent,
  StructureKind,
  ZombieStateSnapshot,
} from '../types/protocol.js';
import { getZombieStats } from './spawner.js';
import type { VisionObstacles } from './vision.js';

export interface StructureDefinition {
  kind: StructureKind;
  name: string;
  woodCost: number;
  scrapCost: number;
  maxHp: number;
  radiusPx: number;
  blocksMovement: boolean;
}

export const STRUCTURE_CATALOG: Readonly<Record<StructureKind, StructureDefinition>> = {
  wood_barricade: {
    kind: 'wood_barricade',
    name: BALANCE.STRUCTURES.WOOD_BARRICADE.NAME,
    woodCost: BALANCE.STRUCTURES.WOOD_BARRICADE.WOOD_COST,
    scrapCost: BALANCE.STRUCTURES.WOOD_BARRICADE.SCRAP_COST,
    maxHp: BALANCE.STRUCTURES.WOOD_BARRICADE.MAX_HP,
    radiusPx: BALANCE.STRUCTURES.WOOD_BARRICADE.RADIUS_PX,
    blocksMovement: BALANCE.STRUCTURES.WOOD_BARRICADE.BLOCKS_MOVEMENT,
  },
  scrap_barricade: {
    kind: 'scrap_barricade',
    name: BALANCE.STRUCTURES.SCRAP_BARRICADE.NAME,
    woodCost: BALANCE.STRUCTURES.SCRAP_BARRICADE.WOOD_COST,
    scrapCost: BALANCE.STRUCTURES.SCRAP_BARRICADE.SCRAP_COST,
    maxHp: BALANCE.STRUCTURES.SCRAP_BARRICADE.MAX_HP,
    radiusPx: BALANCE.STRUCTURES.SCRAP_BARRICADE.RADIUS_PX,
    blocksMovement: BALANCE.STRUCTURES.SCRAP_BARRICADE.BLOCKS_MOVEMENT,
  },
  spike_trap: {
    kind: 'spike_trap',
    name: BALANCE.STRUCTURES.SPIKE_TRAP.NAME,
    woodCost: BALANCE.STRUCTURES.SPIKE_TRAP.WOOD_COST,
    scrapCost: BALANCE.STRUCTURES.SPIKE_TRAP.SCRAP_COST,
    maxHp: BALANCE.STRUCTURES.SPIKE_TRAP.MAX_HP,
    radiusPx: BALANCE.STRUCTURES.SPIKE_TRAP.RADIUS_PX,
    blocksMovement: BALANCE.STRUCTURES.SPIKE_TRAP.BLOCKS_MOVEMENT,
  },
};

export const ALL_STRUCTURE_KINDS: readonly StructureKind[] = [
  'wood_barricade',
  'scrap_barricade',
  'spike_trap',
];

export function isValidStructureKind(raw: unknown): raw is StructureKind {
  return (
    raw === 'wood_barricade' ||
    raw === 'scrap_barricade' ||
    raw === 'spike_trap'
  );
}

export function getStructureDefinition(kind: StructureKind): StructureDefinition {
  return STRUCTURE_CATALOG[kind] ?? STRUCTURE_CATALOG.wood_barricade;
}

export interface InternalBuildableStructure extends BuildableStructureSnapshot {
  attackCooldownMs: number;
  trapTickCooldownMs: number;
}

export function canAffordStructure(
  player: PlayerStateSnapshot,
  kind: StructureKind
): boolean {
  const def = getStructureDefinition(kind);
  return (
    (player.wood ?? 0) >= def.woodCost &&
    (player.scrap ?? 0) >= def.scrapCost
  );
}

export function deductStructureCost(
  player: PlayerStateSnapshot,
  kind: StructureKind
): void {
  const def = getStructureDefinition(kind);
  player.wood = Math.max(0, (player.wood ?? 0) - def.woodCost);
  player.scrap = Math.max(0, (player.scrap ?? 0) - def.scrapCost);
}

/**
 * Calcula e valida a posição de construção à frente do jogador (`BUILD_OFFSET_PX`),
 * garantindo que não sobreponha jogadores vivos, outras fortificações ou obstáculos sólidos.
 */
export function findValidStructurePlacement(
  player: PlayerStateSnapshot,
  kind: StructureKind,
  allPlayers: readonly PlayerStateSnapshot[],
  existingStructures: readonly BuildableStructureSnapshot[],
  obstacles: VisionObstacles,
  mapWidth: number,
  mapHeight: number
): { x: number; y: number } | null {
  if (existingStructures.length >= BALANCE.STRUCTURES.MAX_STRUCTURES) {
    return null;
  }

  const def = getStructureDefinition(kind);
  const offset = BALANCE.STRUCTURES.BUILD_OFFSET_PX;
  const rawX = player.x + Math.cos(player.facingAngle) * offset;
  const rawY = player.y + Math.sin(player.facingAngle) * offset;
  const clamped = clampPositionToArena(
    rawX,
    rawY,
    def.radiusPx + 6,
    mapWidth,
    mapHeight
  );

  // 1. Não pode sobrepor nenhum jogador vivo (quando a estrutura bloqueia movimento)
  if (def.blocksMovement) {
    for (const p of allPlayers) {
      if (!p.alive) {
        continue;
      }
      const minPlayerDist = def.radiusPx + p.radius + 4;
      if (Math.hypot(clamped.x - p.x, clamped.y - p.y) < minPlayerDist) {
        return null;
      }
    }
  }

  // 2. Não pode sobrepor outra fortificação já existente
  for (const s of existingStructures) {
    const minStructDist = def.radiusPx + s.radius + 8;
    if (Math.hypot(clamped.x - s.x, clamped.y - s.y) < minStructDist) {
      return null;
    }
  }

  // 3. Não pode sobrepor obstáculos circulares físicos do cenário (props/caixas)
  for (const c of obstacles.circles) {
    if (!c.blocksMovement) {
      continue;
    }
    const minCircleDist = def.radiusPx + c.radius + 4;
    if (Math.hypot(clamped.x - c.x, clamped.y - c.y) < minCircleDist) {
      return null;
    }
  }

  return {
    x: Math.round(clamped.x),
    y: Math.round(clamped.y),
  };
}

export interface StepStructuresCallbacks {
  emitStructureDamaged: (
    ev: Omit<StructureDamagedEvent, 'eventId' | 'tick'>
  ) => void;
  onZombieKilledByTrap: (
    zombie: ZombieStateSnapshot,
    ownerPlayerId: string,
    damageDealt: number
  ) => void;
  onTrapDamageDealt: (ownerPlayerId: string, damageDealt: number) => void;
  onStructureDestroyed: () => void;
}

/**
 * Processa a interação entre zumbis e fortificações construídas:
 * - Barricadas sólidas (`wood_barricade`, `scrap_barricade`) sofrem ataques dos zumbis encostados a cada 800 ms.
 * - Armadilhas de espinhos (`spike_trap`) aplicam lentidão aos zumbis sobre elas e causam dano periódico a cada 500 ms.
 */
export function stepStructuresAndZombieInteractions(
  structures: InternalBuildableStructure[],
  zombies: ZombieStateSnapshot[],
  dtMs: number,
  callbacks: StepStructuresCallbacks
): void {
  if (structures.length === 0) {
    return;
  }

  let anyDestroyed = false;

  for (let i = structures.length - 1; i >= 0; i -= 1) {
    const struct = structures[i];
    if (struct.hp <= 0) {
      structures.splice(i, 1);
      anyDestroyed = true;
      continue;
    }

    if (struct.attackCooldownMs > 0) {
      struct.attackCooldownMs = Math.max(0, struct.attackCooldownMs - dtMs);
    }
    if (struct.trapTickCooldownMs > 0) {
      struct.trapTickCooldownMs = Math.max(0, struct.trapTickCooldownMs - dtMs);
    }

    const def = getStructureDefinition(struct.kind);

    if (def.blocksMovement) {
      // Barricada sólida: zumbis encostados na borda física (raio + raioZumbi + 8 px) atacam a barricada
      if (struct.attackCooldownMs <= 0) {
        let totalZombieDamage = 0;
        for (let zIdx = 0; zIdx < zombies.length; zIdx += 1) {
          const z = zombies[zIdx];
          if (z.hp <= 0) {
            continue;
          }
          const dist = Math.hypot(z.x - struct.x, z.y - struct.y);
          if (dist <= struct.radius + z.radius + 8) {
            const zStats = getZombieStats(z.kind, z.isElite);
            totalZombieDamage += zStats.contactDamage;
          }
        }

        if (totalZombieDamage > 0) {
          struct.attackCooldownMs = BALANCE.STRUCTURES.ZOMBIE_ATTACK_INTERVAL_MS;
          struct.hp = Math.max(0, struct.hp - totalZombieDamage);
          const destroyed = struct.hp <= 0;
          callbacks.emitStructureDamaged({
            type: 'structure_damaged',
            structureId: struct.id,
            kind: struct.kind,
            x: struct.x,
            y: struct.y,
            damage: totalZombieDamage,
            hpRemaining: struct.hp,
            destroyed,
          });

          if (destroyed) {
            structures.splice(i, 1);
            anyDestroyed = true;
          }
        }
      }
    } else if (struct.kind === 'spike_trap') {
      // Armadilha de espinhos: aplica lentidão contínua e pulso de dano periódico aos zumbis sobre a armadilha
      const overlappingZombies: ZombieStateSnapshot[] = [];
      for (let zIdx = 0; zIdx < zombies.length; zIdx += 1) {
        const z = zombies[zIdx];
        if (z.hp <= 0) {
          continue;
        }
        const dist = Math.hypot(z.x - struct.x, z.y - struct.y);
        if (dist <= struct.radius + z.radius + 2) {
          overlappingZombies.push(z);
          // Reduz o deslocamento do zumbi enquanto atravessa os estrepes
          const slow = BALANCE.STRUCTURES.SPIKE_TRAP.SLOW_MULTIPLIER;
          z.x -= z.vx * 0.05 * (1 - slow);
          z.y -= z.vy * 0.05 * (1 - slow);
        }
      }

      if (overlappingZombies.length > 0 && struct.trapTickCooldownMs <= 0) {
        struct.trapTickCooldownMs = BALANCE.STRUCTURES.SPIKE_TRAP.TICK_INTERVAL_MS;
        const dmg = BALANCE.STRUCTURES.SPIKE_TRAP.DAMAGE_PER_TICK;
        let wear = 0;

        for (const z of overlappingZombies) {
          const applied = Math.min(z.hp, dmg);
          z.hp -= applied;
          wear += BALANCE.STRUCTURES.SPIKE_TRAP.SELF_WEAR_PER_HIT;
          callbacks.onTrapDamageDealt(struct.ownerId, applied);
          if (z.hp <= 0) {
            const idx = zombies.indexOf(z);
            if (idx >= 0) {
              zombies.splice(idx, 1);
            }
            callbacks.onZombieKilledByTrap(z, struct.ownerId, applied);
          }
        }

        if (wear > 0) {
          struct.hp = Math.max(0, struct.hp - wear);
          const destroyed = struct.hp <= 0;
          callbacks.emitStructureDamaged({
            type: 'structure_damaged',
            structureId: struct.id,
            kind: struct.kind,
            x: struct.x,
            y: struct.y,
            damage: wear,
            hpRemaining: struct.hp,
            destroyed,
          });
          if (destroyed) {
            structures.splice(i, 1);
            anyDestroyed = true;
          }
        }
      }
    }
  }

  if (anyDestroyed) {
    callbacks.onStructureDestroyed();
  }
}
