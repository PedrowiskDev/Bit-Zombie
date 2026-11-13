import { BALANCE } from '../config/balance.js';
import {
  SpatialHashGrid,
  checkCircleCollision,
  sweepCircleCircle,
} from '../math/collision.js';
import { clampPositionToArena } from '../math/vec2.js';
import type {
  MeleeSwingEvent,
  PlayerDamagedEvent,
  PlayerRevivedEvent,
  PlayerStateSnapshot,
  ProjectileHitEvent,
  WeaponFireEvent,
  WeaponId,
  WeaponNoiseEvent,
  ZombieStateSnapshot,
} from '../types/protocol.js';
import { getZombieStats } from './spawner.js';
import type { EffectiveWeaponStats } from './upgrades.js';
import {
  angleDifferenceRad,
  findClosestVisibleZombieInCone,
  findProjectileObstacleHit,
  hasLineOfSight,
  resolveEntityObstacleCollisions,
  type VisionObstacles,
} from './vision.js';
import {
  getActiveSlotWeaponState,
  getActiveWeaponId,
  getWeaponDefinition,
  startWeaponReload,
  stepWeaponReload,
  syncPlayerInventorySnapshotFields,
  type PlayerWeaponInventory,
} from './weapons.js';

/**
 * Projétil simulado exclusivamente na `Simulation` (servidor autoritativo / provider local).
 * Não faz parte do snapshot persistente contínuo; emite eventos `fire` e `hit`.
 */
export interface SimulatedProjectile {
  id: number;
  ownerId: string;
  weaponId?: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  knockbackPx?: number;
  distanceTraveled: number;
  maxRange: number;
  pierceRemaining?: number;
  hitZombieIds?: Set<number>;
}

/**
 * Encontra o jogador vivo mais próximo de `(x, y)`.
 * Prioriza jogadores conectados; caso todos os vivos estejam desconectados na janela de 20s,
 * usa qualquer jogador vivo como referência.
 */
export function findClosestLivingPlayer(
  x: number,
  y: number,
  players: Iterable<PlayerStateSnapshot>
): PlayerStateSnapshot | null {
  let closestConnected: PlayerStateSnapshot | null = null;
  let bestConnectedDistSq = Number.POSITIVE_INFINITY;
  let closestAny: PlayerStateSnapshot | null = null;
  let bestAnyDistSq = Number.POSITIVE_INFINITY;

  for (const p of players) {
    if (!p.alive) {
      continue;
    }
    const dx = p.x - x;
    const dy = p.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestAnyDistSq) {
      bestAnyDistSq = distSq;
      closestAny = p;
    }
    if (p.connected && distSq < bestConnectedDistSq) {
      bestConnectedDistSq = distSq;
      closestConnected = p;
    }
  }

  return closestConnected ?? closestAny;
}

/**
 * Encontra o zumbi vivo mais próximo dentro do alcance `maxRangePx` a partir do centro do jogador.
 */
export function findClosestZombieInRange(
  x: number,
  y: number,
  maxRangePx: number,
  zombies: readonly ZombieStateSnapshot[]
): ZombieStateSnapshot | null {
  let closest: ZombieStateSnapshot | null = null;
  let bestDistSq = maxRangePx * maxRangePx;

  for (let i = 0; i < zombies.length; i += 1) {
    const z = zombies[i];
    if (z.hp <= 0) {
      continue;
    }
    const dx = z.x - x;
    const dy = z.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      closest = z;
    }
  }

  return closest;
}

/**
 * Atualiza perseguição dos zumbis em direção ao jogador vivo mais próximo
 * e aplica separação suave círculo-círculo entre zumbis usando SpatialHashGrid.
 */
export function stepZombiesMovementAndSeparation(
  zombies: ZombieStateSnapshot[],
  players: Iterable<PlayerStateSnapshot>,
  dtSec: number,
  mapWidth: number,
  mapHeight: number,
  grid: SpatialHashGrid<ZombieStateSnapshot>,
  obstacles?: VisionObstacles
): void {
  const playerList = Array.from(players);

  // 1. Perseguição ao jogador vivo mais próximo
  for (let i = 0; i < zombies.length; i += 1) {
    const z = zombies[i];
    const target = findClosestLivingPlayer(z.x, z.y, playerList);
    if (!target) {
      z.vx = 0;
      z.vy = 0;
      continue;
    }

    const stats = getZombieStats(z.kind, z.isElite);
    const speedMult = z.speedMultiplier ?? 1;
    const effectiveSpeed = stats.speedPxPerSec * speedMult;
    const dx = target.x - z.x;
    const dy = target.y - z.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 1e-4) {
      const nx = dx / dist;
      const ny = dy / dist;
      z.vx = nx * effectiveSpeed;
      z.vy = ny * effectiveSpeed;
      z.x += z.vx * dtSec;
      z.y += z.vy * dtSec;
      z.facingAngle = Math.atan2(ny, nx);
    } else {
      z.vx = 0;
      z.vy = 0;
    }
  }

  // 2. Separação suave entre zumbis (evita empilhamento em um único ponto)
  grid.clear();
  for (let i = 0; i < zombies.length; i += 1) {
    grid.insert(zombies[i]);
  }

  const maxZombieRadius = BALANCE.ZOMBIES.BRUTE.RADIUS;
  const separationFactor = 0.45; // Separação suave progressiva por tick

  for (let i = 0; i < zombies.length; i += 1) {
    const a = zombies[i];
    const neighbors = grid.queryNearby(a.x, a.y, a.radius + maxZombieRadius);

    for (let j = 0; j < neighbors.length; j += 1) {
      const b = neighbors[j];
      if (b.id <= a.id) {
        continue;
      }

      const col = checkCircleCollision(a.x, a.y, a.radius, b.x, b.y, b.radius);
      if (col.overlapping && col.overlap > 0) {
        const push = col.overlap * 0.5 * separationFactor;
        a.x += col.nx * push;
        a.y += col.ny * push;
        b.x -= col.nx * push;
        b.y -= col.ny * push;
      }
    }
  }

  // 3. Resolve colisão física contra obstáculos sólidos do cenário e limites da arena
  for (let i = 0; i < zombies.length; i += 1) {
    const z = zombies[i];
    const resolved = obstacles
      ? resolveEntityObstacleCollisions(z.x, z.y, z.radius, obstacles, mapWidth, mapHeight)
      : clampPositionToArena(z.x, z.y, z.radius, mapWidth, mapHeight);
    z.x = resolved.x;
    z.y = resolved.y;
  }
}

/**
 * Resolve colisão círculo-círculo entre jogadores vivos e zumbis,
 * aplicando separação física e dano de contato respeitando a janela de invulnerabilidade (0,8 s)
 * e a invulnerabilidade de desconexão (20 s).
 */
export function resolvePlayerZombieCollisionsAndContactDamage(
  players: Iterable<PlayerStateSnapshot>,
  zombies: ZombieStateSnapshot[],
  mapWidth: number,
  mapHeight: number,
  emitPlayerHit: (ev: Omit<PlayerDamagedEvent, 'eventId' | 'tick'>) => void,
  obstacles?: VisionObstacles
): void {
  const invulnDurationMs = Math.round(BALANCE.PLAYER.INVULN_DURATION_SEC * 1000);

  for (const player of players) {
    if (!player.alive) {
      continue;
    }

    for (let i = 0; i < zombies.length; i += 1) {
      const z = zombies[i];
      if (z.hp <= 0) {
        continue;
      }

      const col = checkCircleCollision(
        player.x,
        player.y,
        player.radius,
        z.x,
        z.y,
        z.radius
      );

      if (!col.overlapping) {
        continue;
      }

      // Se o jogador estiver desconectado (janela de 20s), o personagem fica parado e invulnerável:
      // apenas o zumbi é empurrado para fora do círculo do jogador.
      if (!player.connected) {
        if (col.overlap > 0) {
          z.x -= col.nx * col.overlap;
          z.y -= col.ny * col.overlap;
          const clampedZombie = obstacles
            ? resolveEntityObstacleCollisions(z.x, z.y, z.radius, obstacles, mapWidth, mapHeight)
            : clampPositionToArena(z.x, z.y, z.radius, mapWidth, mapHeight);
          z.x = clampedZombie.x;
          z.y = clampedZombie.y;
        }
        continue;
      }

      // Separação física círculo-círculo (35% no jogador, 65% no zumbi)
      if (col.overlap > 0) {
        player.x += col.nx * col.overlap * 0.35;
        player.y += col.ny * col.overlap * 0.35;
        z.x -= col.nx * col.overlap * 0.65;
        z.y -= col.ny * col.overlap * 0.65;

        const clampedPlayer = obstacles
          ? resolveEntityObstacleCollisions(
              player.x,
              player.y,
              player.radius,
              obstacles,
              mapWidth,
              mapHeight
            )
          : clampPositionToArena(
              player.x,
              player.y,
              player.radius,
              mapWidth,
              mapHeight
            );
        player.x = clampedPlayer.x;
        player.y = clampedPlayer.y;

        const clampedZombie = obstacles
          ? resolveEntityObstacleCollisions(z.x, z.y, z.radius, obstacles, mapWidth, mapHeight)
          : clampPositionToArena(
              z.x,
              z.y,
              z.radius,
              mapWidth,
              mapHeight
            );
        z.x = clampedZombie.x;
        z.y = clampedZombie.y;
      }

      // Aplica dano de contato somente se o jogador não estiver na janela de invulnerabilidade
      if (player.invulnMs <= 0 && player.alive && player.connected) {
        const stats = getZombieStats(z.kind, z.isElite);
        player.hp = Math.max(0, player.hp - stats.contactDamage);
        player.invulnMs = invulnDurationMs;
        const killed = player.hp <= 0;
        if (killed) {
          player.alive = false;
          player.vx = 0;
          player.vy = 0;
        }

        emitPlayerHit({
          type: 'player_hit',
          playerId: player.id,
          zombieId: z.id,
          damage: stats.contactDamage,
          hpRemaining: player.hp,
          killed,
        });
      }
    }
  }
}

export interface PlayerManualAimInput {
  aimMode: 'auto' | 'manual';
  aimX: number;
  aimY: number;
  firing: boolean;
}

export interface WeaponStatsPerPlayer {
  damage: number;
  fireRatePerSec: number;
  rangePx: number;
  projectileSpeedPxPerSec: number;
  projectileCount?: number;
  pierceCount?: number;
}

/**
 * Executa a mira e o disparo para cada jogador vivo e conectado (mantido para testes diretos da Etapa 2).
 */
export function stepAutoFireWeapons(
  players: Iterable<PlayerStateSnapshot>,
  zombies: readonly ZombieStateSnapshot[],
  projectiles: SimulatedProjectile[],
  allocateProjectileId: () => number,
  emitFire: (ev: Omit<WeaponFireEvent, 'eventId' | 'tick'>) => void,
  weaponStats?: WeaponStatsPerPlayer,
  manualAimByPlayer?: ReadonlyMap<string, PlayerManualAimInput>,
  getPlayerWeaponStats?: (playerId: string) => WeaponStatsPerPlayer,
  obstacles?: VisionObstacles
): void {
  const spreadStepRad = (7 * Math.PI) / 180;

  for (const player of players) {
    if (!player.alive || !player.connected) {
      continue;
    }

    const pStats = getPlayerWeaponStats ? getPlayerWeaponStats(player.id) : weaponStats;
    const damage = pStats?.damage ?? BALANCE.PISTOL.DAMAGE;
    const fireRatePerSec = pStats?.fireRatePerSec ?? BALANCE.PISTOL.FIRE_RATE_PER_SEC;
    const rangePx = pStats?.rangePx ?? BALANCE.PISTOL.RANGE_PX;
    const projSpeed =
      pStats?.projectileSpeedPxPerSec ?? BALANCE.PISTOL.PROJECTILE_SPEED_PX_PER_SEC;
    const projectileCount = Math.max(1, pStats?.projectileCount ?? 1);
    const pierceCount = Math.max(0, pStats?.pierceCount ?? 0);
    const fireIntervalMs = 1000 / fireRatePerSec;

    const manualState = manualAimByPlayer?.get(player.id);
    const mode = manualState?.aimMode ?? player.aimMode ?? 'auto';
    player.aimMode = mode;

    if (manualState && (manualState.aimX !== 0 || manualState.aimY !== 0)) {
      player.facingAngle = Math.atan2(manualState.aimY, manualState.aimX);
    }

    const spawnBurst = (baseAngle: number, targetZombieId: number) => {
      player.fireCooldownMs = fireIntervalMs;
      const muzzleOffset = player.radius + 4;

      for (let shotIdx = 0; shotIdx < projectileCount; shotIdx += 1) {
        const offsetIndex = shotIdx - (projectileCount - 1) / 2;
        const shotAngle = baseAngle + offsetIndex * spreadStepRad;
        const dirX = Math.cos(shotAngle);
        const dirY = Math.sin(shotAngle);
        const fromX = player.x + dirX * muzzleOffset;
        const fromY = player.y + dirY * muzzleOffset;
        const projId = allocateProjectileId();

        projectiles.push({
          id: projId,
          ownerId: player.id,
          weaponId: 'pistol',
          x: fromX,
          y: fromY,
          vx: dirX * projSpeed,
          vy: dirY * projSpeed,
          radius: BALANCE.PISTOL.PROJECTILE_RADIUS,
          damage,
          distanceTraveled: 0,
          maxRange: rangePx,
          pierceRemaining: pierceCount,
          hitZombieIds: pierceCount > 0 ? new Set<number>() : undefined,
        });

        emitFire({
          type: 'fire',
          projectileId: projId,
          ownerId: player.id,
          weaponId: 'pistol',
          targetZombieId,
          fromX,
          fromY,
          dirX,
          dirY,
          speed: projSpeed,
          range: rangePx,
        });
      }
    };

    if (mode === 'manual') {
      if (player.fireCooldownMs > 0 || !manualState?.firing) {
        continue;
      }

      spawnBurst(player.facingAngle, -1);
      continue;
    }

    if (player.fireCooldownMs > 0) {
      continue;
    }

    const target = obstacles
      ? findClosestVisibleZombieInCone(
          player.x,
          player.y,
          player.facingAngle,
          rangePx,
          zombies,
          obstacles,
          BALANCE.VISION.CONE_ANGLE_DEG
        )
      : findClosestZombieInRange(player.x, player.y, rangePx, zombies);

    if (!target) {
      if (manualState?.firing) {
        spawnBurst(player.facingAngle, -1);
      }
      continue;
    }

    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const dist = Math.hypot(dx, dy);
    const shotAngle = dist > 1e-5 ? Math.atan2(dy, dx) : player.facingAngle;
    spawnBurst(shotAngle, target.id);
  }
}

export interface StepPlayerWeaponsContext {
  players: Iterable<PlayerStateSnapshot>;
  inventoriesByPlayer: Map<string, PlayerWeaponInventory>;
  zombies: ZombieStateSnapshot[];
  projectiles: SimulatedProjectile[];
  dtMs: number;
  mapWidth: number;
  mapHeight: number;
  manualAimByPlayer: ReadonlyMap<string, PlayerManualAimInput>;
  getPlayerEffectiveStats: (playerId: string, weaponId: WeaponId) => EffectiveWeaponStats;
  obstacles: VisionObstacles;
  allocateProjectileId: () => number;
  emitFire: (ev: Omit<WeaponFireEvent, 'eventId' | 'tick'>) => void;
  emitMeleeSwing: (ev: Omit<MeleeSwingEvent, 'eventId' | 'tick'>) => void;
  emitNoise: (ev: Omit<WeaponNoiseEvent, 'eventId' | 'tick'>) => void;
  emitHit: (ev: Omit<ProjectileHitEvent, 'eventId' | 'tick'>) => void;
  onZombieKilled: (zombie: ZombieStateSnapshot, killerId: string) => void;
  onDamageDealt: (damage: number, ownerId: string) => void;
}

function applyMeleeActiveArcHits(
  player: PlayerStateSnapshot,
  inv: PlayerWeaponInventory,
  zombies: ZombieStateSnapshot[],
  mapWidth: number,
  mapHeight: number,
  obstacles: VisionObstacles,
  emitHit: (ev: Omit<ProjectileHitEvent, 'eventId' | 'tick'>) => void,
  onZombieKilled: (zombie: ZombieStateSnapshot, killerId: string) => void,
  onDamageDealt: (damage: number, ownerId: string) => void
): void {
  const swing = inv.meleeSwing;
  if (!swing || swing.phase !== 'active') {
    return;
  }

  const halfArcRad = ((swing.arcDeg * 0.5) * Math.PI) / 180;

  for (let i = 0; i < zombies.length; i += 1) {
    const z = zombies[i];
    if (z.hp <= 0 || swing.hitZombieIds.has(z.id)) {
      continue;
    }

    const dx = z.x - player.x;
    const dy = z.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > swing.rangePx + z.radius) {
      continue;
    }

    if (dist > 1e-4) {
      const targetAngle = Math.atan2(dy, dx);
      const angleDiff = angleDifferenceRad(swing.angle, targetAngle);
      // Permite margem extra quando o zumbi está colado no corpo do jogador
      const closeAllowance = dist <= player.radius + z.radius + 6 ? 0.35 : 0;
      if (angleDiff > halfArcRad + closeAllowance) {
        continue;
      }
    }

    // Validação autoritativa de linha de visão: faca e bastão NÃO atravessam paredes ou portas fechadas
    if (!hasLineOfSight(player.x, player.y, z.x, z.y, obstacles, true)) {
      continue;
    }

    // Marca alvo atingido para que cada golpe acerte cada alvo no máximo 1 vez
    swing.hitZombieIds.add(z.id);

    const actualDamage = Math.min(z.hp, swing.damage);
    z.hp = Math.max(0, z.hp - swing.damage);
    const killed = z.hp <= 0;

    if (actualDamage > 0) {
      player.damageDealt = Number(((player.damageDealt ?? 0) + actualDamage).toFixed(1));
      onDamageDealt(actualDamage, player.id);
    }

    // Pequeno empurrão (knockback) na direção oposta ao jogador para permitir escapar
    if (swing.knockbackPx > 0) {
      const pushDirX = dist > 1e-4 ? dx / dist : Math.cos(swing.angle);
      const pushDirY = dist > 1e-4 ? dy / dist : Math.sin(swing.angle);
      const pushed = resolveEntityObstacleCollisions(
        z.x + pushDirX * swing.knockbackPx,
        z.y + pushDirY * swing.knockbackPx,
        z.radius,
        obstacles,
        mapWidth,
        mapHeight
      );
      z.x = pushed.x;
      z.y = pushed.y;
    }

    if (killed) {
      player.kills += 1;
      onZombieKilled(z, player.id);
    }

    emitHit({
      type: 'hit',
      projectileId: 0,
      ownerId: player.id,
      weaponId: swing.weaponId,
      zombieId: z.id,
      zombieKind: z.kind,
      x: z.x,
      y: z.y,
      damage: swing.damage,
      killed,
    });
  }
}

/**
 * Avança as fases de golpe corpo a corpo (`windup` -> `active` -> `recovery`),
 * recarga com duração, consumo de munição, troca automática de emergência para faca
 * e disparos de armas de fogo (Etapa 3).
 */
export function stepPlayerWeaponsAndMelee(ctx: StepPlayerWeaponsContext): void {
  const {
    players,
    inventoriesByPlayer,
    zombies,
    projectiles,
    dtMs,
    mapWidth,
    mapHeight,
    manualAimByPlayer,
    getPlayerEffectiveStats,
    obstacles,
    allocateProjectileId,
    emitFire,
    emitMeleeSwing,
    emitNoise,
    emitHit,
    onZombieKilled,
    onDamageDealt,
  } = ctx;

  for (const player of players) {
    const inv = inventoriesByPlayer.get(player.id);
    if (!inv) {
      continue;
    }

    if (!player.alive || !player.connected) {
      inv.meleeSwing = null;
      inv.reloadRemainingMs = 0;
      inv.reloadTotalMs = 0;
      inv.reloadingSlot = null;
      syncPlayerInventorySnapshotFields(player, inv);
      continue;
    }

    const manualState = manualAimByPlayer.get(player.id);
    const mode = manualState?.aimMode ?? player.aimMode ?? 'auto';
    player.aimMode = mode;

    if (manualState && (manualState.aimX !== 0 || manualState.aimY !== 0)) {
      player.facingAngle = Math.atan2(manualState.aimY, manualState.aimX);
    }

    // 1. Avança recarga em andamento
    stepWeaponReload(inv, dtMs);

    // 2. Avança golpe corpo a corpo em andamento (windup -> active -> recovery)
    if (inv.meleeSwing) {
      const swing = inv.meleeSwing;
      swing.angle = player.facingAngle;

      if (swing.phase === 'active') {
        applyMeleeActiveArcHits(
          player,
          inv,
          zombies,
          mapWidth,
          mapHeight,
          obstacles,
          emitHit,
          onZombieKilled,
          onDamageDealt
        );
      }

      let remainingToConsume = dtMs;
      while (remainingToConsume > 0 && inv.meleeSwing) {
        const cur = inv.meleeSwing;
        if (cur.phaseRemainingMs > remainingToConsume) {
          cur.phaseRemainingMs -= remainingToConsume;
          remainingToConsume = 0;
          if (cur.phase === 'active') {
            applyMeleeActiveArcHits(
              player,
              inv,
              zombies,
              mapWidth,
              mapHeight,
              obstacles,
              emitHit,
              onZombieKilled,
              onDamageDealt
            );
          }
        } else {
          remainingToConsume -= cur.phaseRemainingMs;
          if (cur.phase === 'windup') {
            cur.phase = 'active';
            cur.phaseRemainingMs = cur.activeMs;
            applyMeleeActiveArcHits(
              player,
              inv,
              zombies,
              mapWidth,
              mapHeight,
              obstacles,
              emitHit,
              onZombieKilled,
              onDamageDealt
            );
          } else if (cur.phase === 'active') {
            cur.phase = 'recovery';
            cur.phaseRemainingMs = cur.recoveryMs;
          } else {
            inv.meleeSwing = null;
          }
        }
      }

      syncPlayerInventorySnapshotFields(player, inv);
      continue;
    }

    // Se estiver recarregando ou em cooldown entre disparos/golpes, sincroniza e aguarda
    if (inv.reloadRemainingMs > 0 || player.fireCooldownMs > 0) {
      syncPlayerInventorySnapshotFields(player, inv);
      continue;
    }

    // 3. Verifica arma ativa e munição no carregador
    let activeWeaponId = getActiveWeaponId(inv);
    let activeDef = getWeaponDefinition(activeWeaponId);
    const slotState = getActiveSlotWeaponState(inv);

    if (
      activeDef.category === 'firearm' &&
      slotState &&
      slotState.magAmmo <= 0
    ) {
      const reserve =
        activeDef.ammoType !== 'none' ? inv.ammoReserve[activeDef.ammoType] : 0;
      if (reserve > 0) {
        const effReload = getPlayerEffectiveStats(player.id, activeWeaponId);
        startWeaponReload(inv, effReload.reloadSpeedMultiplier);
        syncPlayerInventorySnapshotFields(player, inv);
        continue;
      }
      // Sem munição no carregador e sem reserva: a faca permanece acessível como recurso de emergência
      activeWeaponId = 'knife';
      activeDef = getWeaponDefinition('knife');
    }

    const effStats = getPlayerEffectiveStats(player.id, activeWeaponId);

    const triggerMeleeSwing = (attackAngle: number) => {
      const totalCycleMs =
        effStats.windupMs + effStats.activeMs + effStats.recoveryMs;
      player.fireCooldownMs = totalCycleMs;
      inv.meleeSwing = {
        weaponId: activeWeaponId,
        phase: 'windup',
        phaseRemainingMs: effStats.windupMs,
        windupMs: effStats.windupMs,
        activeMs: effStats.activeMs,
        recoveryMs: effStats.recoveryMs,
        angle: attackAngle,
        arcDeg: effStats.arcDeg,
        rangePx: effStats.rangePx,
        damage: effStats.damage,
        knockbackPx: effStats.knockbackPx,
        hitZombieIds: new Set<number>(),
      };

      emitMeleeSwing({
        type: 'melee_swing',
        ownerId: player.id,
        weaponId: activeWeaponId,
        x: player.x,
        y: player.y,
        angle: attackAngle,
        arcDeg: effStats.arcDeg,
        rangePx: effStats.rangePx,
      });

      emitNoise({
        type: 'weapon_noise',
        ownerId: player.id,
        weaponId: activeWeaponId,
        x: player.x,
        y: player.y,
        radiusPx: activeDef.noiseRadiusPx,
      });
    };

    const triggerFirearmBurst = (baseAngle: number, targetZombieId: number) => {
      if (!slotState || slotState.magAmmo <= 0) {
        return;
      }
      slotState.magAmmo = Math.max(0, slotState.magAmmo - 1);
      player.fireCooldownMs = 1000 / effStats.fireRatePerSec;

      const projectileCount = Math.max(1, effStats.projectileCount);
      const spreadStepRad =
        ((activeDef.spreadDeg > 0 ? activeDef.spreadDeg : 5) * Math.PI) / 180;
      const muzzleOffset = player.radius + 4;

      for (let shotIdx = 0; shotIdx < projectileCount; shotIdx += 1) {
        const offsetIndex = shotIdx - (projectileCount - 1) / 2;
        const shotAngle = baseAngle + offsetIndex * spreadStepRad;
        const dirX = Math.cos(shotAngle);
        const dirY = Math.sin(shotAngle);
        const fromX = player.x + dirX * muzzleOffset;
        const fromY = player.y + dirY * muzzleOffset;
        const projId = allocateProjectileId();

        projectiles.push({
          id: projId,
          ownerId: player.id,
          weaponId: activeWeaponId,
          x: fromX,
          y: fromY,
          vx: dirX * effStats.projectileSpeedPxPerSec,
          vy: dirY * effStats.projectileSpeedPxPerSec,
          radius: activeDef.projectileRadius || BALANCE.PISTOL.PROJECTILE_RADIUS,
          damage: effStats.damage,
          knockbackPx: effStats.knockbackPx,
          distanceTraveled: 0,
          maxRange: effStats.rangePx,
          pierceRemaining: effStats.pierceCount,
          hitZombieIds: effStats.pierceCount > 0 ? new Set<number>() : undefined,
        });

        emitFire({
          type: 'fire',
          projectileId: projId,
          ownerId: player.id,
          weaponId: activeWeaponId,
          targetZombieId,
          fromX,
          fromY,
          dirX,
          dirY,
          speed: effStats.projectileSpeedPxPerSec,
          range: effStats.rangePx,
        });
      }

      emitNoise({
        type: 'weapon_noise',
        ownerId: player.id,
        weaponId: activeWeaponId,
        x: player.x,
        y: player.y,
        radiusPx: activeDef.noiseRadiusPx,
      });

      // Se esvaziou o carregador neste disparo e há munição na reserva, inicia recarga automática
      if (
        slotState.magAmmo <= 0 &&
        activeDef.ammoType !== 'none' &&
        inv.ammoReserve[activeDef.ammoType] > 0
      ) {
        startWeaponReload(inv, effStats.reloadSpeedMultiplier);
      }
    };

    if (mode === 'manual') {
      if (manualState?.firing) {
        if (activeDef.category === 'melee') {
          triggerMeleeSwing(player.facingAngle);
        } else {
          triggerFirearmBurst(player.facingAngle, -1);
        }
      }
      syncPlayerInventorySnapshotFields(player, inv);
      continue;
    }

    // Modo automático: seleciona apenas inimigos dentro do cone de visão atual (110°) e com linha de visão válida
    const target = findClosestVisibleZombieInCone(
      player.x,
      player.y,
      player.facingAngle,
      effStats.rangePx,
      zombies,
      obstacles,
      BALANCE.VISION.CONE_ANGLE_DEG
    );

    if (!target) {
      if (manualState?.firing) {
        if (activeDef.category === 'melee') {
          triggerMeleeSwing(player.facingAngle);
        } else {
          triggerFirearmBurst(player.facingAngle, -1);
        }
      }
      syncPlayerInventorySnapshotFields(player, inv);
      continue;
    }

    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const dist = Math.hypot(dx, dy);
    const attackAngle = dist > 1e-5 ? Math.atan2(dy, dx) : player.facingAngle;

    if (activeDef.category === 'melee') {
      triggerMeleeSwing(attackAngle);
    } else {
      triggerFirearmBurst(attackAngle, target.id);
    }

    syncPlayerInventorySnapshotFields(player, inv);
  }

  // Remove zumbis abatidos por golpes corpo a corpo
  for (let i = zombies.length - 1; i >= 0; i -= 1) {
    if (zombies[i].hp <= 0) {
      zombies.splice(i, 1);
    }
  }
}

/**
 * Avança projéteis ativos no servidor/Simulation e resolve impactos contra obstáculos sólidos e zumbis vivos,
 * suportando munição perfurante (`pierceRemaining > 0`), empurrão (`knockbackPx`) e bloqueio por paredes/obstáculos (Etapa 2 + Etapa 3).
 */
export function stepProjectilesAndHits(
  projectiles: SimulatedProjectile[],
  zombies: ZombieStateSnapshot[],
  playersById: Map<string, PlayerStateSnapshot>,
  dtSec: number,
  mapWidth: number,
  mapHeight: number,
  onZombieKilled: (zombie: ZombieStateSnapshot, killerId: string) => void,
  emitHit: (ev: Omit<ProjectileHitEvent, 'eventId' | 'tick'>) => void,
  onDamageDealt?: (damage: number, ownerId: string) => void,
  obstacles?: VisionObstacles
): void {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const proj = projectiles[i];
    const nextX = proj.x + proj.vx * dtSec;
    const nextY = proj.y + proj.vy * dtSec;
    const stepDist = Math.hypot(nextX - proj.x, nextY - proj.y);

    // Verifica colisão com paredes/obstáculos sólidos ao longo do segmento
    const obstacleHit = obstacles
      ? findProjectileObstacleHit(proj.x, proj.y, nextX, nextY, obstacles)
      : null;

    // Encontra o primeiro zumbi vivo atingido ao longo do segmento (proj.x, proj.y) -> (nextX, nextY)
    let earliestT = Number.POSITIVE_INFINITY;
    let hitZombie: ZombieStateSnapshot | null = null;
    let impactX = nextX;
    let impactY = nextY;

    for (let j = 0; j < zombies.length; j += 1) {
      const z = zombies[j];
      if (z.hp <= 0 || proj.hitZombieIds?.has(z.id)) {
        continue;
      }

      const hit = sweepCircleCircle(
        proj.x,
        proj.y,
        nextX,
        nextY,
        proj.radius,
        z.x,
        z.y,
        z.radius
      );

      if (hit && hit.t < earliestT) {
        earliestT = hit.t;
        hitZombie = z;
        impactX = hit.hitX;
        impactY = hit.hitY;
      }
    }

    // Se bateu em uma parede ou obstáculo sólido antes de atingir o zumbi, o projétil é bloqueado
    if (obstacleHit && obstacleHit.tRatio < earliestT) {
      projectiles.splice(i, 1);
      continue;
    }

    if (hitZombie) {
      const actualDamage = Math.min(hitZombie.hp, proj.damage);
      hitZombie.hp = Math.max(0, hitZombie.hp - proj.damage);
      const killed = hitZombie.hp <= 0;

      // Aplica empurrão (knockback) do projétil se configurado (ex.: escopeta/rifle)
      if (!killed && proj.knockbackPx && proj.knockbackPx > 0) {
        const speed = Math.hypot(proj.vx, proj.vy) || 1;
        const pushed = obstacles
          ? resolveEntityObstacleCollisions(
              hitZombie.x + (proj.vx / speed) * proj.knockbackPx,
              hitZombie.y + (proj.vy / speed) * proj.knockbackPx,
              hitZombie.radius,
              obstacles,
              mapWidth,
              mapHeight
            )
          : clampPositionToArena(
              hitZombie.x + (proj.vx / speed) * proj.knockbackPx,
              hitZombie.y + (proj.vy / speed) * proj.knockbackPx,
              hitZombie.radius,
              mapWidth,
              mapHeight
            );
        hitZombie.x = pushed.x;
        hitZombie.y = pushed.y;
      }

      const shooter = playersById.get(proj.ownerId);
      if (shooter && actualDamage > 0) {
        shooter.damageDealt = Number(((shooter.damageDealt ?? 0) + actualDamage).toFixed(1));
      }
      if (actualDamage > 0 && onDamageDealt) {
        onDamageDealt(actualDamage, proj.ownerId);
      }

      if (killed) {
        if (shooter) {
          shooter.kills += 1;
        }
        onZombieKilled(hitZombie, proj.ownerId);
      }

      emitHit({
        type: 'hit',
        projectileId: proj.id,
        ownerId: proj.ownerId,
        weaponId: proj.weaponId,
        zombieId: hitZombie.id,
        zombieKind: hitZombie.kind,
        x: impactX,
        y: impactY,
        damage: proj.damage,
        killed,
      });

      const pierceLeft = proj.pierceRemaining ?? 0;
      if (pierceLeft > 0) {
        proj.pierceRemaining = pierceLeft - 1;
        if (!proj.hitZombieIds) {
          proj.hitZombieIds = new Set<number>();
        }
        proj.hitZombieIds.add(hitZombie.id);
      } else {
        projectiles.splice(i, 1);
        continue;
      }
    }

    proj.x = nextX;
    proj.y = nextY;
    proj.distanceTraveled += stepDist;

    const outOfBounds =
      proj.x < 0 || proj.x > mapWidth || proj.y < 0 || proj.y > mapHeight;
    if (outOfBounds || proj.distanceTraveled >= proj.maxRange) {
      projectiles.splice(i, 1);
    }
  }

  // Remove zumbis abatidos da lista de vivos
  for (let i = zombies.length - 1; i >= 0; i -= 1) {
    if (zombies[i].hp <= 0) {
      zombies.splice(i, 1);
    }
  }
}

/**
 * Processa a mecânica cooperativa de reviver aliado caído (Fase 2):
 * - Quando um jogador conectado está caído (`!downed.alive && downed.connected`) e há ao menos
 *   um aliado vivo e conectado dentro de `BALANCE.REVIVE.RADIUS_PX` (64 px), o progresso de resgate
 *   avança em `dtMs / BALANCE.REVIVE.DURATION_MS` (3,0 s).
 * - Se nenhum aliado estiver dentro do raio, o progresso decai suavemente (`DECAY_RATE = 0.5`).
 * - Ao atingir `1.0`, o jogador caído é revivido com `50%` de `maxHp` e `1,6 s` de invulnerabilidade.
 */
export function stepPlayerReviveMechanics(
  players: Iterable<PlayerStateSnapshot>,
  dtMs: number,
  emitRevived: (ev: Omit<PlayerRevivedEvent, 'eventId' | 'tick'>) => void
): void {
  const playerList = Array.from(players);
  if (playerList.length < 2) {
    return;
  }

  const reviveRadiusSq = BALANCE.REVIVE.RADIUS_PX * BALANCE.REVIVE.RADIUS_PX;
  const stepGain = dtMs / BALANCE.REVIVE.DURATION_MS;
  const stepDecay = stepGain * BALANCE.REVIVE.DECAY_RATE;

  for (let i = 0; i < playerList.length; i += 1) {
    const downed = playerList[i];
    if (downed.alive || !downed.connected) {
      downed.reviveProgress = 0;
      continue;
    }

    let savior: PlayerStateSnapshot | null = null;
    for (let j = 0; j < playerList.length; j += 1) {
      const candidate = playerList[j];
      if (candidate.id === downed.id || !candidate.alive || !candidate.connected) {
        continue;
      }
      const dx = candidate.x - downed.x;
      const dy = candidate.y - downed.y;
      if (dx * dx + dy * dy <= reviveRadiusSq) {
        savior = candidate;
        break;
      }
    }

    const currentProgress = downed.reviveProgress ?? 0;
    if (savior) {
      const nextProgress = Math.min(1, currentProgress + stepGain);
      if (nextProgress >= 1) {
        const restoredHp = Math.max(
          1,
          Math.round(downed.maxHp * BALANCE.REVIVE.RESTORE_HP_RATIO)
        );
        downed.alive = true;
        downed.hp = restoredHp;
        downed.invulnMs = Math.round(BALANCE.REVIVE.INVULN_DURATION_SEC * 1000);
        downed.reviveProgress = 0;
        savior.revivesCount = (savior.revivesCount ?? 0) + 1;

        emitRevived({
          type: 'player_revived',
          revivedPlayerId: downed.id,
          saviorPlayerId: savior.id,
          x: downed.x,
          y: downed.y,
          hpRestored: restoredHp,
        });
      } else {
        downed.reviveProgress = Number(nextProgress.toFixed(4));
      }
    } else if (currentProgress > 0) {
      downed.reviveProgress = Number(
        Math.max(0, currentProgress - stepDecay).toFixed(4)
      );
    }
  }
}
