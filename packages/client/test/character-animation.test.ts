import { readFile } from 'node:fs/promises';
import { BoxGeometry, Mesh, MeshLambertMaterial, Object3D, SkinnedMesh, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { CharacterMotion, motionCues } from '../src/render/CharacterMotion.js';
import { CharacterRig, disposeRigAsset } from '../src/render/CharacterRig.js';

const options = { fallenOnArrival: false, reloadProgress: 0, forceRestart: false };

describe('animações dos personagens', () => {
  it('mantém as pernas em movimento durante golpe ou recarga', () => {
    const motion = new CharacterMotion();
    expect(motion.update(90, true, 0)).toBe('walk');
    expect(motion.react('melee', 12, 0)).toBe(true);
    expect(motion.update(170, true, 0.1)).toBe('melee');
    expect(motion.gait).toBe('run');
    expect(motion.update(170, true, 0.24, { reloadRemainingMs: 300 })).toBe('reload');
    expect(motion.update(0, true, 0.05)).toBe('idle');
  });

  it('ignora reações atrasadas e repetidas e respeita ferimento e queda', () => {
    const motion = new CharacterMotion();
    expect(motion.react('shoot', 10, 0.5)).toBe(false);
    expect(motion.react('shoot', 12, 0.05)).toBe(true);
    expect(motion.react('shoot', 12, 0)).toBe(false);
    expect(motion.react('hit', 13, 0)).toBe(true);
    expect(motion.react('melee', 14, 0)).toBe(false);
    expect(motion.update(140, true, 0.05)).toBe('hit');
    expect(motion.update(140, false, 0.05)).toBe('fall');
    expect(motion.react('shoot', 15, 0)).toBe(false);
    expect(motion.update(0, true, 0.05)).toBe('revive');
    expect(motion.update(0, true, 0.7)).toBe('revive');
    expect(motion.update(0, true, 0.05)).toBe('idle');
  });

  it('atribui o ataque e o ferimento aos atores dos eventos de simulação', () => {
    expect(motionCues({
      type: 'player_hit', eventId: 15, tick: 20, zombieId: 7,
      playerId: 'p1', damage: 20, hpRemaining: 0, killed: true,
    })).toEqual([{ actor: 'zombie:7', action: 'lunge' }, { actor: 'player:p1', action: 'fall' }]);
  });

  it('usa o material texturizado e prende o equipamento ao encaixe do GLB', async () => {
    const data = new Uint8Array(await readFile(new URL('../../../public/models/survivor.glb', import.meta.url)));
    const asset = await new GLTFLoader().parseAsync(data.buffer, '');
    const source = asset.scene.getObjectByName('CharacterMesh') as SkinnedMesh;
    const surface = Array.isArray(source.material) ? source.material[0] : source.material;
    const texture = new Texture();
    Object.assign(surface, { map: texture });
    const disposedTextures: Texture[] = [];
    texture.addEventListener('dispose', () => disposedTextures.push(texture));

    const socket = new Object3D();
    socket.name = 'HeldItemSocket';
    socket.position.set(1.7, -6.4, 2);
    asset.scene.getObjectByName('ForearmR')!.add(socket);
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshLambertMaterial();
    const rig = new CharacterRig(asset, undefined, { geometry, material });
    try {
      rig.update('shoot', 'walk', 90, 0.05, { ...options, weapon: 'pistol', strideYaw: Math.PI / 2 });
      const mesh = rig.model.getObjectByName('CharacterMesh') as SkinnedMesh;
      const grip = rig.model.getObjectByName('HeldItemSocket')!;
      const held = grip.children[0] as Mesh;
      expect(mesh.material).toBe(source.material);
      expect(grip.parent?.name).toBe('ForearmR');
      expect(held.geometry).toBe(geometry);
      expect(held.visible).toBe(true);
      expect(held.position.y).toBeCloseTo(-2.1);
    } finally {
      rig.dispose();
      geometry.dispose();
      material.dispose();
    }
    expect(disposedTextures).toHaveLength(0);
    disposeRigAsset(asset);
    expect(disposedTextures).toEqual([texture]);
  });

  it.each(['survivor', 'zombie'])('carrega o GLB %s e anima rigs com poses independentes', async kind => {
    const path = new URL(`../../../public/models/${kind}.glb`, import.meta.url);
    const data = new Uint8Array(await readFile(path));
    const asset = await new GLTFLoader().parseAsync(data.buffer, '');
    const material = new MeshLambertMaterial({ vertexColors: true });
    const remaining = Array.from({ length: kind === 'zombie' ? 150 : 2 }, () => new CharacterRig(asset, material));
    try {
      const [first, second] = remaining;
      const firstMesh = first.model.getObjectByName('CharacterMesh') as SkinnedMesh;
      const secondMesh = second.model.getObjectByName('CharacterMesh') as SkinnedMesh;
      expect(firstMesh.isSkinnedMesh).toBe(true);
      expect(firstMesh.geometry).toBe(secondMesh.geometry);
      expect(firstMesh.skeleton).not.toBe(secondMesh.skeleton);
      const hips = first.model.getObjectByName('Hips')!;
      const otherHips = second.model.getObjectByName('Hips')!;
      for (let i = 0; i < 8; i++) first.update('fall', 'idle', 0, 0.1, options);
      expect(hips.position.y).toBeCloseTo(4.5);
      expect(otherHips.position.y).toBeCloseTo(17);
      for (let i = 0; i < 9; i++) first.update('revive', 'idle', 0, 0.1, options);
      expect(hips.position.y).toBeCloseTo(17);
      expect(first.model.position.length()).toBe(0);
      for (const rig of remaining.slice(2)) rig.update('walk', 'walk', 70, 0.1, options);
    } finally {
      for (const rig of remaining) rig.dispose();
      disposeRigAsset(asset);
      material.dispose();
    }
  });
});
