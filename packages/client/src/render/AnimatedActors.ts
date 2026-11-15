import * as T from 'three';
import {
  BALANCE, type GameEvent, type PlayerStateSnapshot,
  type ZombieKind, type ZombieStateSnapshot,
} from '@zombie-coop/shared';
import type { RenderWorldState } from '../network/WorldProvider.js';
import { CharacterMotion, motionCues, type MotionCue } from './CharacterMotion.js';
import type { CharacterKind, CharacterRig, PilotRig, RigAsset } from './CharacterRig.js';
import type { GraphicsProfile } from './GraphicsQuality.js';

type Entity = PlayerStateSnapshot | ZombieStateSnapshot;
type Visibility = (x: number, y: number, radius: number) => boolean;

interface Actor {
  root: T.Group;
  proxy: T.Group;
  motion: CharacterMotion;
  rig?: CharacterRig;
  asset?: RigAsset;
  color: number;
  kind: CharacterKind;
  loadedAlive?: boolean;
  deathRemaining?: number;
  radius: number;
  animationDebt: number;
}

type Cue = MotionCue & { tick: number };
const MAX_CORPSES = 16;
const CORPSE_SECONDS = 1.6;
const EVENT_WINDOW_TICKS = 7;
const DEATH_WINDOW_TICKS = 12;
const ZOMBIE_PILOTS: Partial<Record<ZombieKind, PilotRig>> = {
  common: 'zombie',
  fast: 'zombie-fast',
  spitter: 'zombie-spitter',
  demolisher: 'zombie-demolisher',
  brute: 'zombie-brute',
};

export class AnimatedActors {
  private readonly group = new T.Group();
  private readonly actors = new Map<string, Actor>();
  private readonly cues = new Map<string, Cue>();
  private readonly assets = new Map<CharacterKind, RigAsset>();
  private readonly pilotAssets = new Map<PilotRig, RigAsset>();
  private readonly requestedPilots = new Set<PilotRig>();
  private readonly femaleInSolo: boolean;
  private readonly materials = new Map<number, T.MeshLambertMaterial>();
  private readonly heldGeometry = new T.BoxGeometry(1, 1, 1);
  private readonly heldMaterial = new T.MeshLambertMaterial({ color: 0x60666b });
  private rigModule?: typeof import('./CharacterRig.js');
  private disposed = false;
  private match?: string;
  private tick = -1;
  private eventId = -1;

  constructor(
    parent: T.Scene,
    private readonly makeProxy: (color: number, zombie: boolean) => T.Group,
    private readonly applyFog: (material: T.Material) => void,
  ) {
    this.femaleInSolo = new URLSearchParams(window.location.search).get('survivor') === 'female';
    parent.add(this.group);
    this.applyFog(this.heldMaterial);
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const rigModule = await import('./CharacterRig.js');
      if (this.disposed) return;
      this.rigModule = rigModule;
      await Promise.all((['survivor', 'zombie'] as const).map(kind => this.loadAsset(kind, rigModule, false)));
    } catch (error) {
      console.warn('Animação 3D indisponível', error);
    }
  }

  private async loadAsset(
    kind: PilotRig, rigModule: typeof import('./CharacterRig.js'), pilot: boolean,
  ): Promise<void> {
    try {
      const standard = kind === 'survivor' || kind === 'zombie' ? kind : undefined;
      if (!pilot && !standard) return;
      const asset = pilot ? await rigModule.loadPilotRig(kind) : await rigModule.loadRigAsset(standard!);
      if (this.disposed) {
        rigModule.disposeRigAsset(asset);
        return;
      }
      if (pilot) {
        asset.scene.traverse(node => {
          if (!(node instanceof T.SkinnedMesh)) return;
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) this.applyFog(material);
        });
        this.pilotAssets.set(kind, asset);
      } else if (standard) {
        this.assets.set(standard, asset);
      }
    } catch (error) {
      console.warn(`Modelo ${pilot ? 'piloto' : 'padrão'} indisponível: ${kind}`, error);
    }
  }

  private observeWorld(world: RenderWorldState): void {
    const match = `${world.roomCode}:${world.seed}`;
    if ((this.match !== undefined && match !== this.match) || world.tick < this.tick) this.reset();
    this.match = match;
    this.tick = world.tick;
  }

  consume(events: readonly GameEvent[], world: RenderWorldState): void {
    this.observeWorld(world);
    // Keep one reaction per actor and simulation tick. Shotgun pellets share the pose.
    for (const event of events) {
      if (event.eventId <= this.eventId) continue;
      this.eventId = event.eventId;
      for (const cue of motionCues(event)) {
        const window = cue.action === 'fall' ? DEATH_WINDOW_TICKS : EVENT_WINDOW_TICKS;
        if (world.tick - event.tick > window) continue;
        const pending = this.cues.get(cue.actor);
        if (pending?.action === 'fall' || (pending?.action === 'hit' && cue.action !== 'fall')) continue;
        this.cues.set(cue.actor, { ...cue, tick: event.tick });
      }
    }
  }

  update(world: RenderWorldState, visible: Visibility, deltaMs: number,
    quality: GraphicsProfile & { pixelsPerUnit: number }, inFrame: Visibility): void {
    this.observeWorld(world);
    const dt = Math.min(100, Math.max(0, deltaMs)) / 1000;
    const soloFemale = world.roomCode === 'SOLO' && this.femaleInSolo;
    const active = new Set<string>();
    for (const player of world.players) {
      const show = inFrame(player.x, player.y, player.radius);
      const color = BALANCE.NETWORK.PLAYER_COLORS[player.colorIndex] ?? 0x2b95ff;
      const key = `player:${player.id}`;
      active.add(key);
      const female = (player.colorIndex % 2 === 1) !== soloFemale;
      this.present(key, player, 'survivor', color, show, true, dt, 0,
        female ? 'survivor-female' : 'survivor', player);
    }
    const visibleZombies = world.zombies.filter(zombie =>
      inFrame(zombie.x, zombie.y, zombie.radius) && visible(zombie.x, zombie.y, zombie.radius));
    const detailed = new Set(visibleZombies.filter(zombie =>
      zombie.radius * 2 * quality.pixelsPerUnit >= (this.actors.get(`zombie:${zombie.id}`)?.rig ? 16 : 20))
      .sort((a, b) => Number(Boolean(b.isElite)) - Number(Boolean(a.isElite))
        || b.radius - a.radius || a.id - b.id)
      .slice(0, quality.zombieRigs).map(zombie => zombie.id));
    for (const zombie of visibleZombies) {
      const key = `zombie:${zombie.id}`;
      active.add(key);
      this.present(key, zombie, 'zombie', this.zombieColor(zombie), true,
        detailed.has(zombie.id), dt, 1 / quality.animationHz,
        zombie.isElite ? undefined : ZOMBIE_PILOTS[zombie.kind]);
    }
    const living = new Set(world.zombies.map(zombie => zombie.id));

    let corpses = 0;
    for (const [key, actor] of this.actors) {
      if (active.has(key)) continue;
      if (actor.kind === 'zombie' && living.has(Number(key.slice('zombie:'.length)))) {
        this.remove(key, actor);
        continue;
      }
      const { x, z } = actor.root.position;
      const cue = this.cues.get(key);
      if (actor.kind === 'zombie' && cue?.action === 'fall' &&
          world.tick - cue.tick <= DEATH_WINDOW_TICKS && actor.root.visible) {
        actor.deathRemaining = CORPSE_SECONDS;
        this.cues.delete(key);
      }
      if (actor.deathRemaining !== undefined && actor.deathRemaining > 0 && corpses < MAX_CORPSES) {
        corpses++;
        actor.deathRemaining -= dt;
        actor.root.visible = inFrame(x, z, actor.radius) && visible(x, z, actor.radius);
        if (actor.root.visible) this.pose(actor, 0, false, dt, false);
      } else {
        this.remove(key, actor);
      }
    }
    for (const [key, cue] of this.cues) {
      const window = cue.action === 'fall' ? DEATH_WINDOW_TICKS : EVENT_WINDOW_TICKS;
      if (world.tick - cue.tick > window) this.cues.delete(key);
    }
  }

  private present(
    key: string, entity: Entity, kind: CharacterKind, color: number, visible: boolean,
    animated: boolean, dt: number, animationInterval: number, pilot?: PilotRig, player?: PlayerStateSnapshot,
  ): void {
    let actor = this.actors.get(key);
    if (!visible) {
      if (actor) this.remove(key, actor);
      if (this.cues.has(key) && this.cues.get(key)?.action !== 'fall') this.cues.delete(key);
      return;
    }
    if (!actor) {
      const root = new T.Group();
      const proxy = this.makeProxy(color, kind === 'zombie');
      root.add(proxy);
      this.group.add(root);
      actor = { root, proxy, kind, color, motion: new CharacterMotion(), radius: entity.radius, animationDebt: 0 };
      this.actors.set(key, actor);
    }
    actor.deathRemaining = undefined;
    actor.root.visible = true;
    actor.root.position.set(entity.x, 0, entity.y);
    actor.root.rotation.y = -entity.facingAngle;
    actor.root.scale.setScalar(entity.radius / 14);
    actor.radius = entity.radius;
    if (animated) this.ensureRig(actor, pilot);
    else if (actor.rig) this.releaseRig(actor);

    const cue = this.cues.get(key);
    const alive = player?.alive ?? true;
    let restart = false;
    if (cue && cue.tick <= this.tick && (cue.action !== 'fall' || player)) {
      if (cue.action !== 'fall' && alive) {
        restart = actor.motion.react(cue.action, cue.tick, (this.tick - cue.tick) * BALANCE.SIMULATION.TICK_DT_SEC);
      }
      this.cues.delete(key);
    }
    const speed = Math.hypot(entity.vx, entity.vy);
    const strideYaw = speed > 5 ? entity.facingAngle - Math.atan2(entity.vy, entity.vx) : 0;
    this.pose(actor, speed, alive, dt, restart, player, strideYaw, animationInterval);
  }

  private pose(
    actor: Actor, speed: number, alive: boolean, dt: number, restart: boolean,
    player?: PlayerStateSnapshot, strideYaw = 0, animationInterval = 0,
  ): void {
    const action = actor.motion.update(speed, alive, dt, player);
    const pending = player?.reloadRemainingMs ?? 0;
    const total = player?.reloadTotalMs || pending || 1;
    if (actor.rig) {
      actor.animationDebt = Math.min(0.1, actor.animationDebt + dt);
    }
    if (actor.rig && (actor.loadedAlive !== alive || restart || actor.animationDebt >= animationInterval)) {
      actor.rig.update(action, actor.motion.gait, speed, actor.animationDebt, {
        fallenOnArrival: actor.loadedAlive === undefined && !alive,
        reloadProgress: T.MathUtils.clamp(1 - pending / total, 0, 1),
        forceRestart: restart && (action === 'shoot' || action === 'melee' || action === 'lunge' || action === 'hit'),
        weapon: player ? player.activeWeaponId ?? 'knife' : undefined,
        strideYaw,
      });
      actor.loadedAlive = alive;
      actor.animationDebt = 0;
    }
    actor.proxy.visible = !actor.rig;
    actor.proxy.rotation.z = alive ? 0 : -Math.PI / 2;
    actor.proxy.position.y = alive ? 0 : 4;
  }

  private ensureRig(actor: Actor, pilot?: PilotRig): void {
    const rigModule = this.rigModule;
    if (!rigModule) return;
    if (pilot && !this.requestedPilots.has(pilot)) {
      this.requestedPilots.add(pilot);
      void this.loadAsset(pilot, rigModule, true);
    }
    const asset = (pilot ? this.pilotAssets.get(pilot) : undefined) ?? this.assets.get(actor.kind);
    if (actor.asset === asset || !asset) return;
    this.releaseRig(actor);
    let material: T.MeshLambertMaterial | undefined;
    if (!asset.pilot) {
      material = this.materials.get(actor.color);
      if (!material) {
        material = new T.MeshLambertMaterial({ vertexColors: true });
        this.applyFog(material);
        rigModule.configureRigMaterial(material, actor.color);
        this.materials.set(actor.color, material);
      }
    }
    const heldItem = actor.kind === 'survivor'
      ? { geometry: this.heldGeometry, material: this.heldMaterial } : undefined;
    actor.rig = new rigModule.CharacterRig(asset, material, heldItem);
    actor.asset = asset;
    actor.root.add(actor.rig.model);
  }

  private releaseRig(actor: Actor): void {
    if (!actor.rig) return;
    actor.root.remove(actor.rig.model);
    actor.rig.dispose();
    actor.rig = undefined;
    actor.asset = undefined;
    actor.loadedAlive = undefined;
    actor.animationDebt = 0;
  }

  private remove(key: string, actor: Actor): void {
    this.releaseRig(actor);
    this.group.remove(actor.root);
    this.actors.delete(key);
  }

  private zombieColor(zombie: ZombieStateSnapshot): number {
    if (zombie.isElite) return 0xe2a845;
    if (zombie.kind === 'spitter') return 0x93c843;
    if (zombie.kind === 'caller') return 0xac79bd;
    if (zombie.kind === 'demolisher') return 0xa65e45;
    return zombie.kind === 'fast' ? 0xa27049 : 0x77804d;
  }

  get animatedCount(): number {
    let count = 0;
    for (const actor of this.actors.values()) if (actor.rig && actor.root.visible) count++;
    return count;
  }

  reset(): void {
    for (const [key, actor] of this.actors) this.remove(key, actor);
    this.cues.clear();
    this.eventId = -1;
    this.tick = -1;
    this.match = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
    this.group.removeFromParent();
    for (const asset of this.assets.values()) this.rigModule?.disposeRigAsset(asset);
    for (const asset of this.pilotAssets.values()) this.rigModule?.disposeRigAsset(asset);
    for (const material of this.materials.values()) material.dispose();
    this.heldGeometry.dispose();
    this.heldMaterial.dispose();
    this.assets.clear();
    this.pilotAssets.clear();
    this.materials.clear();
  }
}
