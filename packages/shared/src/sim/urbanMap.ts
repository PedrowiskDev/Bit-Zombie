import { BALANCE } from '../config/balance.js';
import { SeededRng } from '../math/rng.js';
import type { BuildableStructureSnapshot } from '../types/protocol.js';
import type { CircleObstacle, SegmentObstacle } from './vision.js';

export interface HouseFurniture extends CircleObstacle {
  kind: 'sofa' | 'cabinet' | 'counter';
}

export interface HouseLayout {
  doorId: number;
  partitionY: number;
  passageHalfWidth: number;
  rooms: { kind: 'living' | 'kitchen'; x: number; y: number; width: number; depth: number }[];
  furniture: HouseFurniture[];
  supply: { x: number; y: number };
  garden: { x: number; y: number }[];
}

const sites = [
  { name: 'Casa', color: 0x695b4b, wood: 2, scrap: 0, medkits: 0 },
  { name: 'Mercadinho', color: 0x5e6851, wood: 1, scrap: 1, medkits: 1 },
  { name: 'Posto de combustível', color: 0x5c626b, wood: 0, scrap: 2, medkits: 0 },
  { name: 'Oficina', color: 0x78634c, wood: 0, scrap: 4, medkits: 0 },
  { name: 'Depósito', color: 0x6d5a50, wood: 5, scrap: 2, medkits: 0 },
  { name: 'Pequena clínica', color: 0x536b67, wood: 0, scrap: 0, medkits: 3 },
] as const;

export function generateUrbanMap(seed: number, width = Number(BALANCE.MAP.WIDTH), height = Number(BALANCE.MAP.HEIGHT)) {
  const rng = new SeededRng(seed ^ 0x481a826d);
  const buildings = width < 1800 || height < 1800 ? [] : sites.map((site, index) => ({
    ...site,
    doorId: -(index + 1),
    x: Math.round(width * (0.21 + (index % 3) * 0.29) + rng.nextRange(-58, 58)),
    y: Math.round(height * (index < 3 ? 0.19 : 0.81) + rng.nextRange(-58, 58)),
    halfWidth: rng.nextInt(112, 146),
    halfHeight: rng.nextInt(84, 110),
  }));
  const walls: SegmentObstacle[] = [];
  const windows: SegmentObstacle[] = [];
  const doors: BuildableStructureSnapshot[] = [];
  let house: HouseLayout | undefined;
  for (const b of buildings) {
    const l = b.x - b.halfWidth;
    const r = b.x + b.halfWidth;
    const t = b.y - b.halfHeight;
    const bottom = b.y + b.halfHeight;
    const wall = (x1: number, y1: number, x2: number, y2: number): SegmentObstacle =>
      ({ x1, y1, x2, y2, blocksVision: true, blocksMovement: true, blocksProjectiles: true });
    walls.push(wall(l, t, l, bottom), wall(r, t, r, bottom));
    walls.push(wall(l, t, b.x - 30, t), wall(b.x + 30, t, r, t));
    walls.push(wall(l, bottom, b.x - 35, bottom), wall(b.x + 35, bottom, r, bottom));
    windows.push({ ...wall(b.x - 30, t, b.x + 30, t), blocksVision: false, blocksProjectiles: false });
    doors.push({
      id: b.doorId, kind: 'map_door', x: b.x, y: bottom, rotation: 0,
      radius: 35, hp: 90, maxHp: 90, ownerId: '', label: 'Porta', open: false,
    });
    if (b.name === 'Casa') {
      // The interior arch lines up with the exterior door and leaves a straight central aisle.
      const passageHalfWidth = 41;
      walls.push(wall(l, b.y, b.x - passageHalfWidth, b.y), wall(b.x + passageHalfWidth, b.y, r, b.y));
      const furniture = (kind: HouseFurniture['kind'], side: number, dy: number, radius: number,
        cover = false): HouseFurniture => ({
          kind, x: b.x + side * (b.halfWidth - 30), y: b.y + dy, radius,
          blocksMovement: true, blocksVision: cover, blocksProjectiles: cover,
        });
      house = {
        doorId: b.doorId, partitionY: b.y, passageHalfWidth,
        rooms: [
          { kind: 'living', x: b.x, y: b.y + b.halfHeight / 2, width: 2 * b.halfWidth, depth: b.halfHeight },
          { kind: 'kitchen', x: b.x, y: b.y - b.halfHeight / 2, width: 2 * b.halfWidth, depth: b.halfHeight },
        ],
        furniture: [
          furniture('sofa', -1, b.halfHeight / 2, 24),
          furniture('cabinet', -1, -b.halfHeight / 2, 18, true),
          furniture('counter', 1, -b.halfHeight / 2, 23),
        ],
        supply: { x: b.x + 42, y: b.y - b.halfHeight + 23 },
        garden: [
          { x: b.x - 62, y: bottom + 29 }, { x: b.x + 62, y: bottom + 29 },
          { x: l + 10, y: bottom + 25 }, { x: r - 10, y: bottom + 25 },
        ],
      };
    }
  }
  return { buildings, walls, windows, doors, house };
}

export type UrbanMap = ReturnType<typeof generateUrbanMap>;
