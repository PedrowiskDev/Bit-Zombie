import * as T from 'three';
import type { PropData } from '@zombie-coop/shared';

const SECTOR_SIZE = 640;

export function buildStaticPropBatches(
  target: T.Group, props: readonly PropData[], cube: T.BufferGeometry, head: T.BufferGeometry,
  materialFor: (color: number) => T.MeshLambertMaterial,
): T.InstancedMesh[] {
  const groups = new Map<string, { geometry: T.BufferGeometry; color: number; poses: T.Matrix4[] }>();
  const propPose = new T.Object3D();
  const part = new T.Object3D();
  const add = (prop: PropData, geometry: T.BufferGeometry, color: number,
    x: number, y: number, width: number, height: number, depth: number) => {
    const key = `${Math.floor(prop.x / SECTOR_SIZE)}:${Math.floor(prop.y / SECTOR_SIZE)}:${geometry.id}:${color}`;
    let group = groups.get(key);
    if (!group) {
      group = { geometry, color, poses: [] };
      groups.set(key, group);
    }
    part.position.set(x, y, 0);
    part.scale.set(width, height, depth);
    part.updateMatrix();
    group.poses.push(new T.Matrix4().multiplyMatrices(propPose.matrix, part.matrix));
  };
  for (const prop of props) {
    const car = prop.kind === 'car';
    const bush = prop.kind === 'bush';
    const width = (car ? 84 : bush ? 43 : 37) * prop.scale;
    const depth = (car ? 44 : 36) * prop.scale;
    propPose.position.set(prop.x, 0, prop.y);
    propPose.rotation.y = -prop.rotation;
    propPose.updateMatrix();
    add(prop, bush ? head : cube, car ? 0x70675d : bush ? 0x415e36 : 0x817360, 0, 10, width, 20, depth);
    if (car) add(prop, cube, 0x434e52, -5, 22, width * 0.48, 10, depth * 0.8);
  }
  const batches: T.InstancedMesh[] = [];
  for (const { geometry, color, poses } of groups.values()) {
    const batch = new T.InstancedMesh(geometry, materialFor(color), poses.length);
    poses.forEach((pose, index) => batch.setMatrixAt(index, pose));
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingSphere();
    target.add(batch);
    batches.push(batch);
  }
  return batches;
}
