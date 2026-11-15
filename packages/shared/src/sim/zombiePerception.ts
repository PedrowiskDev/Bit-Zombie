import type { Vec2 } from '../math/vec2.js';
import type { PlayerStateSnapshot, ZombieStateSnapshot } from '../types/protocol.js';
import { hasLineOfSight, type VisionObstacles } from './vision.js';
import type { UrbanMap } from './urbanMap.js';
import { BALANCE } from '../config/balance.js';
import { planZombieDetour } from './zombieNavigation.js';

export interface ZombieNoise extends Vec2 {
  radius: number;
  kind?: 'door' | 'footsteps' | 'call' | 'action';
}

interface Intent {
  mode: 'wander' | 'investigate' | 'chase' | 'search';
  goal: Vec2;
  expires: number;
  scanAfter?: number;
}

const SIGHT_RANGE = 820;
const SEARCH_MS = 5500;
const HEARING_MS = 14000;
const NEAR_SIGHT = 96;
const SIGHT_HALF_ANGLE = 105 * Math.PI / 180;
const SIGHT_COSINE = Math.cos(SIGHT_HALF_ANGLE);
const ROUTE_REFRESH_MS = 400;
const MAX_ROUTE_PLANS_PER_TICK = 8;

interface AgentMemory {
  seenId?: string;
  lookedAt?: VisionObstacles;
  route?: { goal: Vec2; points: Vec2[]; origin: Vec2; obstacleSet: VisionObstacles; refreshAt: number };
}

export function canZombieSee(zombie: ZombieStateSnapshot, player: PlayerStateSnapshot, obstacles: VisionObstacles): boolean {
  const dx = player.x - zombie.x;
  const dy = player.y - zombie.y;
  const distance = Math.hypot(dx, dy);
  if (!player.alive || distance >= SIGHT_RANGE) return false;
  const directional = zombie.kind !== 'spitter' && zombie.kind !== 'caller';
  if (directional && distance > NEAR_SIGHT &&
      dx * Math.cos(zombie.facingAngle) + dy * Math.sin(zombie.facingAngle) < distance * SIGHT_COSINE) return false;
  return hasLineOfSight(zombie.x, zombie.y, player.x, player.y, obstacles);
}

export class ZombiePerception {
  private readonly intents = new Map<number, Intent>();
  private readonly agents = new Map<number, AgentMemory>();
  private plannedAt = -1;
  private plans = 0;

  reset(): void {
    this.intents.clear();
    this.agents.clear();
    this.plannedAt = -1;
    this.plans = 0;
  }

  forget(id: number): void {
    this.intents.delete(id);
    this.agents.delete(id);
  }

  target(
    zombie: ZombieStateSnapshot, players: readonly PlayerStateSnapshot[],
    noises: readonly ZombieNoise[], now: number, obstacles: VisionObstacles, map: UrbanMap,
    width: number, height: number,
  ): Vec2 {
    let memory = this.agents.get(zombie.id);
    if (!memory) {
      memory = {};
      this.agents.set(zombie.id, memory);
    }
    let intent = this.intents.get(zombie.id);
    let seen = players.find(player => player.id === memory.seenId && canZombieSee(zombie, player, obstacles));
    let closest = SIGHT_RANGE;
    if (memory.lookedAt !== obstacles || (now / BALANCE.SIMULATION.TICK_DT_MS + zombie.id) % 3 === 0) {
      if (seen) closest = Math.hypot(seen.x - zombie.x, seen.y - zombie.y);
      for (const player of players) {
        if (!player.alive || player === seen) continue;
        const distance = Math.hypot(player.x - zombie.x, player.y - zombie.y);
        if (distance < closest && canZombieSee(zombie, player, obstacles)) {
          closest = distance;
          seen = player;
        }
      }
      memory.lookedAt = obstacles;
    }
    memory.seenId = seen?.id;

    if (seen) {
      intent = { mode: 'chase', goal: { x: seen.x, y: seen.y }, expires: now + SEARCH_MS };
      if (zombie.kind === 'spitter' && Math.hypot(seen.x - zombie.x, seen.y - zombie.y) <= 235 &&
          hasLineOfSight(zombie.x, zombie.y, seen.x, seen.y, obstacles, true)) {
        this.intents.set(zombie.id, intent);
        zombie.facingAngle = Math.atan2(seen.y - zombie.y, seen.x - zombie.x);
        return zombie;
      }
    } else if (intent?.mode === 'chase') {
      intent = { ...intent, mode: 'search', expires: now + SEARCH_MS };
    }

    if (!seen) {
      // Once tracking a location, nearby footsteps or a door breaking do not overwrite it.
      let strongest = intent?.mode === 'search' && now < intent.expires ? 0.65 : 1;
      let heard: ZombieNoise | undefined;
      for (const noise of noises) {
        if (noise.radius <= 0) continue;
        if (intent && intent.mode !== 'wander' && now < intent.expires &&
            (noise.kind === 'door' || noise.kind === 'footsteps')) continue;
        const ratio = Math.hypot(noise.x - zombie.x, noise.y - zombie.y) / noise.radius;
        if (ratio < strongest) {
          strongest = ratio;
          heard = noise;
        }
      }
      if (heard) intent = { mode: 'investigate', goal: { x: heard.x, y: heard.y }, expires: now + HEARING_MS };
    }

    if (intent && !seen && now < intent.expires &&
        Math.hypot(intent.goal.x - zombie.x, intent.goal.y - zombie.y) < 20 &&
        (intent.mode === 'search' || intent.mode === 'investigate')) {
      intent.scanAfter ??= now + 1200;
      if (now < intent.scanAfter) {
        this.intents.set(zombie.id, intent);
        zombie.facingAngle += 0.12;
        return zombie;
      }
      intent = undefined;
    }

    if (!intent || now >= intent.expires ||
        (intent.mode === 'wander' && Math.hypot(intent.goal.x - zombie.x, intent.goal.y - zombie.y) < 20)) {
      const angle = zombie.id * 2.399963 + Math.floor(now / 3500) * 1.618;
      intent = {
        mode: 'wander',
        goal: { x: zombie.x + Math.cos(angle) * 130, y: zombie.y + Math.sin(angle) * 130 },
        expires: now + 3500,
      };
    }
    this.intents.set(zombie.id, intent);
    const waypoint = routeAroundBuildings(zombie, intent.goal, map);
    return this.navigate(zombie, waypoint, memory, now, obstacles, width, height);
  }

  private navigate(zombie: ZombieStateSnapshot, goal: Vec2, memory: AgentMemory, now: number,
    obstacles: VisionObstacles, width: number, height: number): Vec2 {
    if (this.plannedAt !== now) {
      this.plannedAt = now;
      this.plans = 0;
    }
    let route = memory.route;
    const dx = goal.x - zombie.x;
    const dy = goal.y - zombie.y;
    const nearGoal = Math.hypot(dx, dy) < 4;
    if (route?.obstacleSet !== obstacles) route = undefined;
    const goalMoved = route && Math.hypot(goal.x - route.goal.x, goal.y - route.goal.y) >= 24;
    const stalled = route && Math.hypot(zombie.x - route.origin.x, zombie.y - route.origin.y) < 6;
    const blockedTick = route?.points.length === 0;
    if (!nearGoal && this.plans < MAX_ROUTE_PLANS_PER_TICK &&
        (!route || (now >= route.refreshAt && (goalMoved || stalled || blockedTick)))) {
      this.plans++;
      route = {
        goal, origin: { x: zombie.x, y: zombie.y }, obstacleSet: obstacles,
        refreshAt: now + ROUTE_REFRESH_MS + zombie.id % 4 * BALANCE.SIMULATION.TICK_DT_MS,
        points: planZombieDetour(zombie, goal, zombie.radius, obstacles, width, height),
      };
      memory.route = route;
    }
    while (route?.points.length && Math.hypot(zombie.x - route.points[0].x, zombie.y - route.points[0].y) < 4) {
      route.points.shift();
    }
    if (!nearGoal && route?.points.length) return route.points[0];
    return steerAroundProps(zombie, goal, obstacles);
  }
}

/** Encaminha a perseguiÃ§Ã£o pela porta ou pelos cantos externos de um prÃ©dio. */
function routeAroundBuildings(zombie: ZombieStateSnapshot, goal: Vec2, map: UrbanMap): Vec2 {
  const clearance = zombie.radius + 12;
  for (const b of map.buildings) {
    const inside = (point: Vec2) => Math.abs(point.x - b.x) < b.halfWidth &&
      Math.abs(point.y - b.y) < b.halfHeight;
    const doorY = b.y + b.halfHeight;
    const house = map.house?.doorId === b.doorId ? map.house : undefined;
    const inAisle = Math.abs(zombie.x - b.x) <= 12;
    if (inside(zombie)) {
      if (house) {
        const otherRoom = (zombie.y < house.partitionY) !== (goal.y < house.partitionY);
        if (otherRoom && !inAisle) {
          // Reach the aisle on this side before crossing the partition.
          const side = zombie.y < house.partitionY ? -1 : 1;
          return { x: b.x, y: house.partitionY + side * Math.max(clearance, Math.abs(zombie.y - house.partitionY)) };
        }
        if (otherRoom) {
          return { x: b.x, y: house.partitionY + (goal.y < house.partitionY ? -clearance : clearance) };
        }
        if (inAisle && Math.abs(zombie.y - house.partitionY) < clearance &&
            Math.abs(goal.y - house.partitionY) >= clearance) {
          return { x: b.x, y: house.partitionY + (goal.y < house.partitionY ? -clearance : clearance) };
        }
      }
      if (!inside(goal)) return { x: b.x, y: doorY + clearance };
      continue;
    }
    const entering = inside(goal);
    const left = b.x - b.halfWidth - clearance;
    const right = b.x + b.halfWidth + clearance;
    const top = b.y - b.halfHeight - clearance;
    const bottom = doorY + clearance;
    const approach = { x: b.x, y: bottom };
    if (entering && zombie.y >= doorY && Math.abs(zombie.x - b.x) <= 12) {
      return house ? { x: b.x, y: doorY - clearance } : goal;
    }
    const target = entering ? approach : goal;
    // InterseÃ§Ã£o de segmento com o interior do retÃ¢ngulo de seguranÃ§a.
    const crosses = (from: Vec2, to: Vec2) => {
      let lo = 0;
      let hi = 1;
      for (const [a, delta, min, max] of [
        [from.x, to.x - from.x, left + 5, right - 5],
        [from.y, to.y - from.y, top + 5, bottom - 5],
      ]) {
        if (Math.abs(delta) < 1e-6) {
          if (a <= min || a >= max) return false;
          continue;
        }
        const t1 = (min - a) / delta;
        const t2 = (max - a) / delta;
        lo = Math.max(lo, Math.min(t1, t2));
        hi = Math.min(hi, Math.max(t1, t2));
        if (lo >= hi) return false;
      }
      return true;
    };
    if (!crosses(zombie, target)) {
      if (entering) return target;
      continue;
    }

    const corners = [{ x: left, y: top }, { x: right, y: top },
      { x: right, y: bottom }, { x: left, y: bottom }];
    let best: Vec2 | undefined;
    let cost = Infinity;
    for (const corner of corners) {
      const distance = Math.hypot(corner.x - zombie.x, corner.y - zombie.y);
      if (distance < 3 || crosses(zombie, corner)) continue;
      for (const exit of corners) {
        if (crosses(corner, exit) || crosses(exit, target)) continue;
        const length = distance + Math.hypot(exit.x - corner.x, exit.y - corner.y) +
          Math.hypot(target.x - exit.x, target.y - exit.y);
        if (length < cost) {
          cost = length;
          best = corner;
        }
      }
    }
    if (best) return best;
    // Uma entidade encostada na parede precisa primeiro sair da margem de seguranÃ§a.
    const sides = [
      { x: left, y: zombie.y }, { x: right, y: zombie.y },
      { x: zombie.x, y: top }, { x: zombie.x, y: bottom },
    ];
    return sides.reduce((nearest, side) =>
      Math.hypot(side.x - zombie.x, side.y - zombie.y) <
      Math.hypot(nearest.x - zombie.x, nearest.y - zombie.y) ? side : nearest);
  }
  return goal;
}

export function steerAroundProps(zombie: ZombieStateSnapshot, goal: Vec2, obstacles: VisionObstacles): Vec2 {
  // Portas e barricadas ficam a cargo das rotinas de ataque jÃ¡ existentes.
  const dx = goal.x - zombie.x;
  const dy = goal.y - zombie.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return goal;
  const [nx, ny] = [dx / distance, dy / distance];
  const lookAhead = Math.min(distance, zombie.radius + 20);
  for (const c of obstacles.circles) {
    if (!c.blocksMovement || c.kind === 'wood_barricade' || c.kind === 'scrap_barricade') continue;
    const ahead = (c.x - zombie.x) * nx + (c.y - zombie.y) * ny;
    const side = (c.x - zombie.x) * ny - (c.y - zombie.y) * nx;
    if (ahead <= 0 || ahead > lookAhead + c.radius || Math.abs(side) >= c.radius + zombie.radius + 4) continue;
    const sign = side < 0 ? -1 : 1;
    return { x: zombie.x + nx * 18 - ny * sign * 38, y: zombie.y + ny * 18 + nx * sign * 38 };
  }
  return goal;
}
