/// <reference types="vite/client" />
import * as T from 'three';
import type { WeaponId } from '@zombie-coop/shared';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Motion } from './CharacterMotion.js';

export type CharacterKind = 'survivor' | 'zombie';
export type PilotRig = CharacterKind | 'survivor-female' | 'zombie-fast' | 'zombie-spitter'
  | 'zombie-demolisher' | 'zombie-brute';
export type RigAsset = Pick<GLTF, 'scene' | 'animations'> & { pilot?: boolean };

const STANCE: ReadonlySet<Motion> = new Set(['idle', 'walk', 'run']);
const UPPER: ReadonlySet<Motion> = new Set(['shoot', 'melee', 'lunge', 'reload']);
const REQUIRED: Motion[] = ['idle', 'walk', 'run', 'shoot', 'melee', 'lunge', 'hit', 'reload', 'fall', 'revive'];
const splitClips = new WeakMap<T.AnimationClip, { legs: T.AnimationClip; upper: T.AnimationClip }>();

export function disposeRigAsset(asset: RigAsset): void {
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  const images = new Set<ImageBitmap>();
  asset.scene.traverse((node) => {
    if (node instanceof T.SkinnedMesh) {
      node.skeleton.dispose();
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    }
  });
  for (const material of materials) {
    if (material instanceof T.MeshStandardMaterial) {
      for (const texture of [material.map, material.normalMap, material.roughnessMap,
        material.metalnessMap, material.aoMap, material.emissiveMap]) {
        if (texture) textures.add(texture);
      }
    }
    material.dispose();
  }
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) images.add(texture.image);
    texture.dispose();
  }
  for (const image of images) image.close();
}

export async function loadRigAsset(kind: CharacterKind): Promise<RigAsset> {
  return validateRig(await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/${kind}.glb`), kind);
}

export async function loadPilotRig(kind: PilotRig): Promise<RigAsset> {
  const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const asset = validateRig(await loader.loadAsync(
    `${import.meta.env.BASE_URL}models/${kind}-rig.glb`,
  ), kind);
  asset.pilot = true;
  return asset;
}

function validateRig(asset: RigAsset, kind: PilotRig): RigAsset {
  if (!REQUIRED.every(name => asset.animations.some(clip => clip.name === name)) ||
      !(asset.scene.getObjectByName('CharacterMesh') instanceof T.SkinnedMesh)) {
    disposeRigAsset(asset);
    throw new Error(`Modelo incompleto: ${kind}`);
  }
  return asset;
}

export function configureRigMaterial(material: T.MeshLambertMaterial, color: number): void {
  const applyFog = material.onBeforeCompile;
  const tint = new T.Color(color);
  material.onBeforeCompile = (shader, renderer) => {
    applyFog.call(material, shader, renderer);
    shader.uniforms.teamTint = { value: tint };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _team;\nvarying float teamWeight;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nteamWeight = _team;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 teamTint;\nvarying float teamWeight;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.28), teamTint, 0.72), teamWeight);');
  };
}

export class CharacterRig {
  readonly model: T.Object3D;
  private readonly mixer: T.AnimationMixer;
  private active?: T.AnimationAction;
  private activeName?: Motion;
  private legs?: T.AnimationAction;
  private legsName?: Motion;
  private retired: { action: T.AnimationAction; remaining: number }[] = [];
  private readonly clips: readonly T.AnimationClip[];
  private readonly heldItem?: T.Mesh;
  private readonly hasGripSocket: boolean;
  private readonly hips?: T.Object3D;
  private readonly spine?: T.Object3D;
  private readonly locomotionYaw = new T.Quaternion();
  private readonly hipsPose = new T.Quaternion();
  private readonly spinePose = new T.Quaternion();
  private adjustedStride = false;
  private readonly up = new T.Vector3(0, 1, 0);
  private equipped?: WeaponId;

  constructor(
    asset: RigAsset, material: T.MeshLambertMaterial | undefined,
    heldItem?: { geometry: T.BufferGeometry; material: T.MeshLambertMaterial },
  ) {
    this.model = clone(asset.scene);
    this.model.traverse(node => {
      if (node instanceof T.SkinnedMesh) {
        if (material) node.material = material;
        // Animated bounds can extend beyond the standing bind pose.
        node.frustumCulled = false;
      }
    });
    this.mixer = new T.AnimationMixer(this.model);
    this.clips = asset.animations;
    this.hips = this.model.getObjectByName('Hips');
    this.spine = this.model.getObjectByName('Spine');
    const socket = this.model.getObjectByName('HeldItemSocket');
    this.hasGripSocket = Boolean(socket);
    const hand = socket ?? this.model.getObjectByName('ForearmR');
    if (heldItem && hand) {
      this.heldItem = new T.Mesh(heldItem.geometry, heldItem.material);
      this.heldItem.visible = false;
      hand.add(this.heldItem);
    }
  }

  private clip(name: Motion, split?: 'legs' | 'upper'): T.AnimationClip {
    const clip = this.clips.find(candidate => candidate.name === name)!;
    if (!split) return clip;
    let cached = splitClips.get(clip);
    if (!cached) {
      const isLower = (track: T.KeyframeTrack) => /^(Hips|Leg[LR]|Shin[LR])\./.test(track.name);
      cached = {
        legs: new T.AnimationClip(`${name}-legs`, clip.duration, clip.tracks.filter(isLower)),
        upper: new T.AnimationClip(`${name}-upper`, clip.duration, clip.tracks.filter(track => !isLower(track))),
      };
      splitClips.set(clip, cached);
    }
    return cached[split];
  }

  private transition(previous: T.AnimationAction | undefined, clip: T.AnimationClip, loop: boolean, blend: number) {
    const next = this.mixer.clipAction(clip);
    if (previous === next) return next.reset().play();
    this.retired = this.retired.filter(entry => entry.action !== next);
    next.reset().setLoop(loop ? T.LoopRepeat : T.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.play();
    if (previous && blend > 0) {
      next.crossFadeFrom(previous, blend, false);
      this.retired.push({ action: previous, remaining: blend });
    } else previous?.stop();
    return next;
  }

  private retireLegs(): void {
    if (!this.legs) return;
    this.legs.fadeOut(0.09);
    this.retired.push({ action: this.legs, remaining: 0.09 });
    this.legs = undefined;
    this.legsName = undefined;
  }

  update(
    motion: Motion, gait: 'idle' | 'walk' | 'run', speed: number, dt: number,
    options: {
      fallenOnArrival: boolean;
      reloadProgress: number;
      forceRestart: boolean;
      weapon?: WeaponId;
      strideYaw?: number;
    },
  ): void {
    if (this.adjustedStride && this.hips && this.spine) {
      this.hips.quaternion.copy(this.hipsPose);
      this.spine.quaternion.copy(this.spinePose);
      this.adjustedStride = false;
    }
    this.updateHeldItem(options.weapon);
    const full = motion === 'hit' || motion === 'fall' || motion === 'revive';
    const name = STANCE.has(motion) ? gait : motion;
    if (name !== this.activeName || options.forceRestart) {
      const clip = this.clip(name, full || UPPER.has(name) ? undefined : 'upper');
      this.active = this.transition(this.active, clip, STANCE.has(name), name === 'fall' ? 0.05 : 0.09);
      if (name === 'fall' && options.fallenOnArrival) this.active.time = clip.duration;
      this.activeName = name;
    }
    if (full) {
      this.retireLegs();
    } else if (this.legsName !== gait) {
      this.legs = this.transition(this.legs, this.clip(gait, 'legs'), true, 0.12);
      this.legsName = gait;
    }
    const pace = gait === 'idle' ? 1 : T.MathUtils.clamp(speed / (gait === 'run' ? 180 : 95), 0.6, 1.55);
    this.legs?.setEffectiveTimeScale(pace);
    if (this.active && STANCE.has(name)) this.active.setEffectiveTimeScale(pace);
    if (this.active && name === 'reload') {
      this.active.paused = true;
      this.active.time = options.reloadProgress * this.active.getClip().duration;
    }
    this.mixer.update(dt);
    if (!full && gait !== 'idle' && options.strideYaw && this.hips && this.spine) {
      this.hipsPose.copy(this.hips.quaternion);
      this.spinePose.copy(this.spine.quaternion);
      this.locomotionYaw.setFromAxisAngle(this.up, options.strideYaw);
      this.hips.quaternion.premultiply(this.locomotionYaw);
      this.spine.quaternion.premultiply(this.locomotionYaw.invert());
      this.adjustedStride = true;
    }
    this.retired = this.retired.filter(entry => {
      entry.remaining -= dt;
      if (entry.remaining > 0) return true;
      entry.action.stop();
      return false;
    });
  }

  private updateHeldItem(weapon?: WeaponId): void {
    if (!this.heldItem || this.equipped === weapon) return;
    this.equipped = weapon;
    const length = weapon === 'knife' ? 5 : weapon === 'bat' ? 12
      : weapon === 'shotgun' || weapon === 'rifle' ? 13 : 7;
    this.heldItem.visible = weapon !== undefined;
    if (this.hasGripSocket) {
      this.heldItem.position.set(0, -length * (weapon === 'knife' ? 0.43 : 0.30), 0);
    } else {
      this.heldItem.position.set(0.9, -4.9 - length * 0.33, 0);
    }
    this.heldItem.scale.set(weapon === 'knife' ? 1.3 : 2.7, length, weapon === 'knife' ? 0.6 : 2);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.model.traverse(node => {
      if (node instanceof T.SkinnedMesh) node.skeleton.dispose();
    });
  }
}
