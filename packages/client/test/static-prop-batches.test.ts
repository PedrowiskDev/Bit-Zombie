import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { buildStaticPropBatches } from '../src/render/StaticPropBatches.js';

describe('lotes de objetos estáticos', () => {
  it('preserva posição e rotação, compartilha a malha e separa setores distantes', () => {
    const target = new T.Group();
    const cube = new T.BoxGeometry();
    const bush = new T.IcosahedronGeometry();
    const material = new T.MeshLambertMaterial();
    const batches = buildStaticPropBatches(target, [
      { id: 1, kind: 'car', x: 150, y: 40, rotation: Math.PI / 2, scale: 1, variant: 0 },
      { id: 2, kind: 'car', x: 250, y: 40, rotation: 0, scale: 1, variant: 0 },
      { id: 3, kind: 'car', x: 850, y: 40, rotation: 0, scale: 1, variant: 0 },
    ], cube, bush, () => material);
    try {
      expect(batches).toHaveLength(4); // two parts per sector, previously six meshes
      const matrices = batches.filter(batch => batch.count === 2).map(batch => {
        const matrix = new T.Matrix4();
        batch.getMatrixAt(0, matrix);
        return new T.Vector3().setFromMatrixPosition(matrix);
      });
      expect(matrices[0]).toEqual(new T.Vector3(150, 10, 40));
      expect(matrices[1].z).toBeCloseTo(35);
      expect(matrices[1].y).toBeCloseTo(22);
      for (const batch of batches) expect(batch.boundingSphere?.radius).toBeGreaterThan(0);
    } finally {
      batches.forEach(batch => batch.dispose());
      cube.dispose();
      bush.dispose();
      material.dispose();
    }
  });
});
