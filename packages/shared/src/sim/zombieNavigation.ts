import type { Vec2 } from '../math/vec2.js';
import { intersectRaySegment, type VisionObstacles } from './vision.js';

const MAX_OBSTACLES = 12;
const MAX_ROUTE_NODES = 50;
const ROUTE_REACH = 200;

function distanceSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

interface Barrier {
  a: Vec2;
  b: Vec2;
  clearance: number;
}

/** Plans a local detour. Doors and barricades remain targets for existing contact attacks. */
export function planZombieDetour(
  start: Vec2, destination: Vec2, radius: number, obstacles: VisionObstacles,
  width: number, height: number,
): Vec2[] {
  const distance = Math.hypot(destination.x - start.x, destination.y - start.y);
  const fraction = Math.min(1, ROUTE_REACH / Math.max(1, distance));
  const goal = {
    x: Math.max(radius, Math.min(width - radius, start.x + (destination.x - start.x) * fraction)),
    y: Math.max(radius, Math.min(height - radius, start.y + (destination.y - start.y) * fraction)),
  };
  const barriers: Barrier[] = [];
  const nearbySq = (ROUTE_REACH + 90) ** 2;
  for (const s of obstacles.segments) {
    if (s.blocksMovement === false || s.doorId !== undefined) continue;
    const a = { x: s.x1, y: s.y1 };
    const b = { x: s.x2, y: s.y2 };
    if (distanceSq(start, a, b) <= nearbySq) barriers.push({ a, b, clearance: radius + 4 });
  }
  for (const c of obstacles.circles) {
    if (!c.blocksMovement || c.kind === 'wood_barricade' || c.kind === 'scrap_barricade') continue;
    if ((c.x - start.x) ** 2 + (c.y - start.y) ** 2 <= nearbySq) {
      barriers.push({ a: c, b: c, clearance: radius + c.radius });
    }
  }

  function clear(from: Vec2, to: Vec2): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) return true;
    return barriers.every(({ a, b, clearance }) => {
      const limit = (clearance - 0.05) ** 2;
      return distanceSq(a, from, to) >= limit && distanceSq(b, from, to) >= limit &&
        distanceSq(from, a, b) >= limit && distanceSq(to, a, b) >= limit &&
        intersectRaySegment(from.x, from.y, dx / length, dy / length, length, a.x, a.y, b.x, b.y) === null;
    });
  }

  if (clear(start, goal)) return [goal];
  barriers.sort((a, b) => distanceSq(start, a.a, a.b) - distanceSq(start, b.a, b.b));
  const nodes = [start];
  const add = (x: number, y: number) => {
    if (nodes.length >= MAX_ROUTE_NODES - 1 || x < radius || x > width - radius ||
        y < radius || y > height - radius ||
        barriers.some(b => distanceSq({ x, y }, b.a, b.b) < b.clearance ** 2)) return;
    nodes.push({ x, y });
  };
  for (const { a, b, clearance } of barriers.slice(0, MAX_OBSTACLES)) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.01) {
      const offset = clearance * 1.15 + 2;
      for (let i = 0; i < 8; i++) add(a.x + Math.cos(i * Math.PI / 4) * offset,
        a.y + Math.sin(i * Math.PI / 4) * offset);
    } else {
      const ux = (b.x - a.x) / length;
      const uy = (b.y - a.y) / length;
      const side = clearance + 2;
      // Small shoulder points also fit through narrow doors.
      for (const sign of [-1, 1]) {
        add(a.x - ux * 2 - uy * side * sign, a.y - uy * 2 + ux * side * sign);
        add(b.x + ux * 2 - uy * side * sign, b.y + uy * 2 + ux * side * sign);
      }
      add(a.x - ux * side, a.y - uy * side);
      add(b.x + ux * side, b.y + uy * side);
      const corner = (clearance + 2) / Math.SQRT2;
      for (const sign of [-1, 1]) {
        add(a.x - ux * corner - uy * corner * sign, a.y - uy * corner + ux * corner * sign);
        add(b.x + ux * corner - uy * corner * sign, b.y + uy * corner + ux * corner * sign);
      }
    }
  }
  const finish = nodes.push(goal) - 1;
  const costs = nodes.map(() => Infinity);
  const parents = nodes.map(() => -1);
  const visited = new Set<number>();
  costs[0] = 0;
  let best = 0;
  const toGoal = (p: Vec2) => Math.hypot(p.x - goal.x, p.y - goal.y);
  for (let i = 0; i < nodes.length; i++) {
    let current = -1;
    let estimate = Infinity;
    for (let j = 0; j < nodes.length; j++) {
      const score = costs[j] + toGoal(nodes[j]);
      if (!visited.has(j) && score < estimate) {
        current = j;
        estimate = score;
      }
    }
    if (current === -1) break;
    if (toGoal(nodes[current]) < toGoal(nodes[best])) best = current;
    if (current === finish) break;
    visited.add(current);
    for (let next = 1; next < nodes.length; next++) {
      if (visited.has(next)) continue;
      const cost = costs[current] + Math.hypot(nodes[current].x - nodes[next].x, nodes[current].y - nodes[next].y);
      if (cost >= costs[next] || !clear(nodes[current], nodes[next])) continue;
      costs[next] = cost;
      parents[next] = current;
    }
  }
  const route: Vec2[] = [];
  for (let i = best; i > 0; i = parents[i]) route.push(nodes[i]);
  return route.reverse();
}
