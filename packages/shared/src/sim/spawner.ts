import { BALANCE } from '../config/balance.js';
import { SeededRng } from '../math/rng.js';
import { clampPositionToArena } from '../math/vec2.js';
import type {
  PlayerStateSnapshot,
  ZombieKind,
  ZombieStateSnapshot,
} from '../types/protocol.js';

export interface ZombieStatsConfig {
  hp: number;
  speedPxPerSec: number;
  contactDamage: number;
  contactCooldownSec: number;
  radius: number;
  xp: number;
}

export function getZombieStats(kind: ZombieKind, isElite = false): ZombieStatsConfig {
  let base: ZombieStatsConfig;
  switch (kind) {
    case 'fast':
      base = {
        hp: BALANCE.ZOMBIES.FAST.HP,
        speedPxPerSec: BALANCE.ZOMBIES.FAST.SPEED_PX_PER_SEC,
        contactDamage: BALANCE.ZOMBIES.FAST.CONTACT_DAMAGE,
        contactCooldownSec: BALANCE.ZOMBIES.FAST.CONTACT_COOLDOWN_SEC,
        radius: BALANCE.ZOMBIES.FAST.RADIUS,
        xp: BALANCE.ZOMBIES.FAST.XP,
      };
      break;
    case 'brute':
      base = {
        hp: BALANCE.ZOMBIES.BRUTE.HP,
        speedPxPerSec: BALANCE.ZOMBIES.BRUTE.SPEED_PX_PER_SEC,
        contactDamage: BALANCE.ZOMBIES.BRUTE.CONTACT_DAMAGE,
        contactCooldownSec: BALANCE.ZOMBIES.BRUTE.CONTACT_COOLDOWN_SEC,
        radius: BALANCE.ZOMBIES.BRUTE.RADIUS,
        xp: BALANCE.ZOMBIES.BRUTE.XP,
      };
      break;
    case 'common':
    default:
      base = {
        hp: BALANCE.ZOMBIES.COMMON.HP,
        speedPxPerSec: BALANCE.ZOMBIES.COMMON.SPEED_PX_PER_SEC,
        contactDamage: BALANCE.ZOMBIES.COMMON.CONTACT_DAMAGE,
        contactCooldownSec: BALANCE.ZOMBIES.COMMON.CONTACT_COOLDOWN_SEC,
        radius: BALANCE.ZOMBIES.COMMON.RADIUS,
        xp: BALANCE.ZOMBIES.COMMON.XP,
      };
      break;
  }

  if (!isElite) {
    return base;
  }

  return {
    hp: Math.round(base.hp * BALANCE.ROUNDS.ELITE_HP_MULTIPLIER),
    speedPxPerSec: Math.round(base.speedPxPerSec * 1.1),
    contactDamage: Math.round(base.contactDamage * BALANCE.ROUNDS.ELITE_DAMAGE_MULTIPLIER),
    contactCooldownSec: base.contactCooldownSec,
    radius: Math.max(base.radius + 4, BALANCE.ROUNDS.ELITE_RADIUS_PX),
    xp: BALANCE.ROUNDS.ELITE_XP_REWARD,
  };
}

/**
 * Calcula a taxa de spawn instantânea (zumbis/s):
 * - 0,8 zumbi/s no início
 * - +10% por minuto decorrido
 * - Escalado pelo número de jogadores vivos (1x para 1 jogador, 2x para 2 jogadores)
 */
export function computeSpawnRatePerSec(elapsedMs: number, activePlayerCount: number): number {
  if (activePlayerCount <= 0) {
    return 0;
  }
  const minutes = Math.max(0, elapsedMs) / 60000;
  const timeFactor = 1 + BALANCE.SPAWN.MINUTE_GROWTH_FACTOR * minutes;
  return BALANCE.SPAWN.INITIAL_RATE_PER_SEC * timeFactor * activePlayerCount;
}

/**
 * Sorteia deterministicamente o tipo de zumbi com base na seed e no tempo de partida.
 * Os três tipos (comum, rápido, brutamontes) participam desde o início, com leve aumento
 * na proporção de rápidos e brutamontes conforme os minutos avançam.
 */
export function pickZombieKind(rng: SeededRng, elapsedMs: number): ZombieKind {
  const minutes = Math.min(10, Math.max(0, elapsedMs) / 60000);
  const bruteChance = Math.min(0.22, 0.1 + minutes * 0.012);
  const fastChance = Math.min(0.35, 0.22 + minutes * 0.013);

  const roll = rng.nextFloat();
  if (roll < bruteChance) {
    return 'brute';
  }
  if (roll < bruteChance + fastChance) {
    return 'fast';
  }
  return 'common';
}

/**
 * Escolhe uma posição de spawn em anel [RING_MIN_RADIUS, RING_MAX_RADIUS] (fora da tela 960x540)
 * ao redor de um jogador vivo, garantindo que o ponto fique dentro dos limites do mapa
 * e fora do raio mínimo de visão de todos os jogadores vivos.
 */
export function pickRingSpawnPosition(
  rng: SeededRng,
  livingPlayers: PlayerStateSnapshot[],
  zombieRadius: number,
  mapWidth: number,
  mapHeight: number
): { x: number; y: number } {
  if (livingPlayers.length === 0) {
    return { x: zombieRadius + 20, y: zombieRadius + 20 };
  }

  const anchor = livingPlayers[rng.nextInt(0, livingPlayers.length - 1)];
  const minR = BALANCE.SPAWN.RING_MIN_RADIUS;
  const maxR = BALANCE.SPAWN.RING_MAX_RADIUS;
  const minSafeDistSq = minR * minR;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const angle = rng.nextRange(0, Math.PI * 2);
    const dist = rng.nextRange(minR, maxR);
    const candidateX = anchor.x + Math.cos(angle) * dist;
    const candidateY = anchor.y + Math.sin(angle) * dist;

    const clamped = clampPositionToArena(
      candidateX,
      candidateY,
      zombieRadius,
      mapWidth,
      mapHeight
    );

    let farFromAllPlayers = true;
    for (let i = 0; i < livingPlayers.length; i += 1) {
      const p = livingPlayers[i];
      const dx = clamped.x - p.x;
      const dy = clamped.y - p.y;
      if (dx * dx + dy * dy < minSafeDistSq * 0.92) {
        farFromAllPlayers = false;
        break;
      }
    }

    if (farFromAllPlayers) {
      return clamped;
    }
  }

  // Fallback quando o jogador está encostado em um canto do mapa:
  // aponta na direção do centro da arena com leve abertura angular
  const toCenterAngle = Math.atan2(mapHeight * 0.5 - anchor.y, mapWidth * 0.5 - anchor.x);
  const spread = rng.nextRange(-0.65, 0.65);
  const dist = rng.nextRange(minR, maxR);
  return clampPositionToArena(
    anchor.x + Math.cos(toCenterAngle + spread) * dist,
    anchor.y + Math.sin(toCenterAngle + spread) * dist,
    zombieRadius,
    mapWidth,
    mapHeight
  );
}

export function createZombieEntity(
  id: number,
  kind: ZombieKind,
  x: number,
  y: number,
  options?: {
    isElite?: boolean;
    spawnSource?: ZombieStateSnapshot['spawnSource'];
    speedMultiplier?: number;
  }
): ZombieStateSnapshot {
  const isElite = Boolean(options?.isElite);
  const stats = getZombieStats(kind, isElite);
  return {
    id,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    facingAngle: 0,
    radius: stats.radius,
    hp: stats.hp,
    maxHp: stats.hp,
    isElite,
    spawnSource: options?.spawnSource ?? 'manual',
    speedMultiplier: options?.speedMultiplier ?? 1,
  };
}
