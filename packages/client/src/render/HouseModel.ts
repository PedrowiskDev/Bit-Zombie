import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HouseLayout, UrbanMap } from '@zombie-coop/shared';

type Building = UrbanMap['buildings'][number];
type Box = (parent: T.Group, color: number, x: number, y: number, z: number,
  width: number, height: number, depth: number) => T.Mesh;

/** Static house finishes share a mesh per color. Occluding wall segments stay individually addressable. */
export function buildHouseFinishes(parent: T.Group, house: HouseLayout, building: Building, mesh: Box) {
  const groups = new Map<number, T.BufferGeometry[]>();
  const add = (color: number, x: number, y: number, z: number, w: number, h: number, d: number, pitch = 0) => {
    const box = new T.BoxGeometry(w, h, d);
    box.rotateX(pitch);
    box.translate(x - building.x, y, z - building.y);
    const batch = groups.get(color) ?? [];
    batch.push(box);
    groups.set(color, batch);
  };
  const { x, y, halfWidth: w, halfHeight: d } = building;
  for (const room of house.rooms) {
    const living = room.kind === 'living';
    add(living ? 0x956d4e : 0xa4a596, room.x, 0.6, room.y, room.width, 1.2, room.depth - 0.2);
    const stripes = Math.floor(room.depth / 12);
    for (let i = 1; i <= stripes; i++) {
      const z = room.y - room.depth / 2 + i * 12;
      add(living ? 0x835b40 : 0x8d9187, room.x, 1.24, z, room.width - 6, 0.08, 0.75);
    }
  }
  add(0x736d5d, x, 0.4, y + d + 18, 68, 2, 38);
  add(0x764b39, x - 52, 1.3, y + d / 2, 65, 0.25, 46);
  add(0xb29a71, x - 52, 1.46, y + d / 2 - 20, 63, 0.08, 2);
  add(0xb29a71, x - 52, 1.46, y + d / 2 + 20, 63, 0.08, 2);
  for (const item of house.furniture) {
    const { x: fx, y: fz, radius: r } = item;
    if (item.kind === 'sofa') {
      add(0x4c605f, fx, 5, fz, r * 1.6, 9, r);
      add(0x617a76, fx, 10.5, fz - 1, r * 1.4, 3, r * 0.72);
      add(0x4c605f, fx, 14, fz + 9, r * 1.6, 12, 5);
      for (const side of [-1, 1]) add(0x4c605f, fx + side * 17, 12, fz - 2, 4, 7, 19);
    } else if (item.kind === 'cabinet') {
      add(0x70513b, fx, 18, fz, r * 1.55, 34, r * 1.25);
      add(0x9a7452, fx, 18, fz + r * 0.62, r * 1.4, 30, 1);
      for (const side of [-1, 1]) add(0x433d37, fx + side * 4, 17, fz + r * 0.67, 1, 4, 1);
    } else {
      add(0x5b7772, fx, 10, fz, r * 1.55, 18, r);
      add(0xc1b8a2, fx, 20, fz, r * 1.65, 2, r * 1.04);
      add(0x777f78, fx, 21.2, fz, 12, 0.5, 10);
    }
  }
  for (const [i, plant] of house.garden.entries()) {
    const spread = i % 2 === 0 ? 12 : 15;
    add(0x79624b, plant.x, 2, plant.y, spread, 5, spread);
    for (const side of [-1, 0, 1]) {
      add(side === 0 ? 0x506e43 : 0x6d844a, plant.x + side * 4, 8 - Math.abs(side) * 2,
        plant.y, 6, 9, 6, side * 0.24);
    }
  }

  const finishes = new T.Group();
  finishes.position.set(x, 0, y);
  parent.add(finishes);
  const geometries: T.BufferGeometry[] = [];
  for (const [color, parts] of groups) {
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    const item = mesh(finishes, color, 0, 0, 0, 1, 1, 1);
    item.geometry = geometry;
    geometries.push(geometry);
  }

  // A pitched roof uses the same two halves on every seed; its group is hidden indoors.
  const roof = new T.Group();
  parent.add(roof);
  const pitch = Math.atan2(21, d + 5);
  const slope = Math.hypot(d + 5, 21);
  for (const side of [-1, 1]) {
    const panel = mesh(roof, 0x694944, x, 47, y + side * (d + 5) / 2, w * 2 + 12, 5, slope + 1.5);
    panel.rotation.x = side * pitch;
  }
  return { roof, geometries };
}
