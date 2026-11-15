import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BALANCE, generateUrbanMap, type BuildableStructureSnapshot, type GameEvent } from '@zombie-coop/shared';
import type { IWorldProvider } from '../network/WorldProvider.js';
import type { GroundProjection } from './GroundProjection.js';
import type { GraphicsCounters } from './FrameProfiler.js';
import { AnimatedActors } from './AnimatedActors.js';
import { buildHouseFinishes } from './HouseModel.js';
import { buildStaticPropBatches } from './StaticPropBatches.js';
import { GraphicsQuality, type QualityMode } from './GraphicsQuality.js';

type World = ReturnType<IWorldProvider['getRenderState']>;

export class WorldRenderer3D {
  private readonly renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  private readonly scene = new T.Scene();
  private readonly camera = new T.OrthographicCamera();
  private readonly terrain = new T.Group();
  private readonly actors = new T.Group();
  private readonly characters: AnimatedActors;
  private readonly roofs: T.Object3D[] = [];
  private houseGeometries: T.BufferGeometry[] = [];
  private houseCrate?: { root: T.Group; lid: T.Mesh };
  private readonly cutaways = new Map<T.Mesh, {
    opaque: T.MeshLambertMaterial;
    faded: T.MeshLambertMaterial;
  }>();
  private readonly wallMeshes: T.Mesh[] = [];
  private readonly occlusionRay = new T.Raycaster();
  private readonly eye = new T.Vector3();
  private readonly subject = new T.Vector3();
  private readonly offset = new T.Vector3();
  private readonly direction = new T.Vector3();
  private readonly occluders = new Set<T.Object3D>();
  private readonly fogSize = new T.Vector2(1, 1);
  private readonly fogMap: T.CanvasTexture;
  private readonly lowFogMap: T.CanvasTexture;
  private readonly lowFogContext: CanvasRenderingContext2D;
  private fogDirty = true;
  private readonly meshes = new Map<string, T.Group>();
  private readonly materials = new Map<number, T.MeshLambertMaterial>();
  private readonly cube = new T.BoxGeometry(1, 1, 1);
  private readonly body = new T.CylinderGeometry(0.36, 0.52, 1, 6);
  private readonly head = new T.IcosahedronGeometry(0.5);
  private map?: ReturnType<typeof generateUrbanMap>;
  private seed?: number;
  private width = 0;
  private height = 0;
  private readonly quality = new GraphicsQuality();
  private propBatches: T.InstancedMesh[] = [];
  private readonly zombieProxy = this.buildZombieProxy();

  constructor(
    parent: HTMLElement, private readonly fogCanvas: HTMLCanvasElement,
    private readonly onAvailabilityChange: () => void,
  ) {
    this.fogMap = new T.CanvasTexture(fogCanvas);
    this.fogMap.generateMipmaps = false;
    this.fogMap.minFilter = T.LinearFilter;
    const lowFogCanvas = document.createElement('canvas');
    lowFogCanvas.width = lowFogCanvas.height = 512;
    this.lowFogContext = lowFogCanvas.getContext('2d')!;
    this.lowFogMap = new T.CanvasTexture(lowFogCanvas);
    this.lowFogMap.generateMipmaps = false;
    this.lowFogMap.minFilter = T.LinearFilter;
    const canvas = this.renderer.domElement;
    canvas.dataset.worldRenderer = 'three';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onAvailabilityChange);
    Object.assign(canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '0', visibility: 'hidden',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x0c0f0d);
    parent.prepend(canvas);
    this.scene.add(this.terrain, this.actors, new T.HemisphereLight(0xc6dae2, 0x50402c, 2));
    const sun = new T.DirectionalLight(0xffe5c7, 2);
    sun.position.set(-400, 800, -300);
    this.scene.add(sun);
    this.characters = new AnimatedActors(this.scene, (color, zombie) => this.createActorProxy(color, zombie),
      material => this.attachFog(material));
    this.camera.near = 1;
    this.camera.far = 1800;
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.renderer.domElement.style.visibility = 'hidden';
    this.onAvailabilityChange();
  };

  private mesh(parent: T.Group, color: number, x: number, y: number, z: number,
               width: number, height: number, depth: number, geometry: T.BufferGeometry = this.cube): T.Mesh {
    const mesh = new T.Mesh(geometry, this.materialFor(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    parent.add(mesh);
    return mesh;
  }

  private materialFor(color: number): T.MeshLambertMaterial {
    let material = this.materials.get(color);
    if (!material) {
      material = new T.MeshLambertMaterial({ color, flatShading: true });
      this.attachFog(material);
      this.materials.set(color, material);
    }
    return material;
  }

  markFogDirty(): void {
    this.fogDirty = true;
  }

  private readonly fogUniform: { value: T.CanvasTexture | null } = { value: null };

  private attachFog(material: T.Material): void {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.worldFog = this.fogUniform;
      shader.uniforms.worldFogSize = { value: this.fogSize };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 fogXZ;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 fogPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            fogPosition = instanceMatrix * fogPosition;
          #endif
          fogXZ = (modelMatrix * fogPosition).xz;
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 fogXZ;\nuniform sampler2D worldFog;\nuniform vec2 worldFogSize;')
        .replace('#include <opaque_fragment>', `
          float fogOpacity = texture2D(worldFog, vec2(fogXZ.x / worldFogSize.x, 1.0 - fogXZ.y / worldFogSize.y)).a;
          outgoingLight = mix(outgoingLight, vec3(0.002, 0.003, 0.002), fogOpacity);
          #include <opaque_fragment>
        `);
    };
  }

  private updateCutaways(local: { x: number; y: number } | undefined, offset: T.Vector3, deltaMs: number): void {
    this.occluders.clear();
    if (local) {
      this.subject.set(local.x, 19, local.y);
      this.eye.copy(this.subject).add(offset);
      this.occlusionRay.set(this.eye, this.direction.copy(offset).negate().normalize());
      this.occlusionRay.far = offset.length();
      for (const hit of this.occlusionRay.intersectObjects(this.wallMeshes, false)) {
        if (hit.object.visible && hit.object.parent?.visible) this.occluders.add(hit.object);
      }
    }
    const blend = 1 - Math.exp(-18 * Math.min(100, Math.max(0, deltaMs)) / 1000);
    for (const [mesh, { opaque, faded }] of this.cutaways) {
      const goal = this.occluders.has(mesh) ? 0.22 : 1;
      faded.opacity += (goal - faded.opacity) * blend;
      mesh.material = faded.opacity > 0.995 ? opaque : faded;
    }
  }

  private addCutaway(mesh: T.Mesh): void {
    const opaque = mesh.material as T.MeshLambertMaterial;
    const faded = opaque.clone();
    faded.transparent = true;
    faded.depthWrite = false;
    this.attachFog(faded);
    this.cutaways.set(mesh, { opaque, faded });
    this.wallMeshes.push(mesh);
  }

  private clearCutaways(): void {
    for (const { faded } of this.cutaways.values()) faded.dispose();
    this.wallMeshes.length = 0;
    this.cutaways.clear();
  }

  private buildTerrain(world: World): void {
    this.seed = world.seed;
    this.fogSize.set(world.mapWidth, world.mapHeight);
    this.clearCutaways();
    for (const geometry of this.houseGeometries) geometry.dispose();
    this.houseGeometries = [];
    this.houseCrate = undefined;
    this.propBatches.forEach(batch => batch.dispose());
    this.terrain.clear();
    this.roofs.length = 0;
    this.map = generateUrbanMap(world.seed, world.mapWidth, world.mapHeight);
    this.mesh(this.terrain, 0x384438, world.mapWidth / 2, -2, world.mapHeight / 2, world.mapWidth, 2, world.mapHeight);
    for (const row of [0.19, 0.81]) {
      const z = world.mapHeight * row + 208;
      this.mesh(this.terrain, 0x36393a, world.mapWidth / 2, 0, z, world.mapWidth, 1, 72);
      this.mesh(this.terrain, 0x7e7257, world.mapWidth / 2, 1, z, world.mapWidth, 1, 2);
    }
    for (const column of [0.355, 0.645]) {
      this.mesh(this.terrain, 0x36393a, world.mapWidth * column, 1, world.mapHeight / 2, 72, 1, world.mapHeight);
    }
    for (const b of this.map.buildings) {
      if (this.map.house?.doorId === b.doorId) {
        const { roof, geometries } = buildHouseFinishes(this.terrain, this.map.house, b, this.mesh.bind(this));
        this.houseGeometries = geometries;
        this.roofs.push(roof);
        for (const panel of roof.children) this.addCutaway(panel as T.Mesh);
        const root = new T.Group();
        root.position.set(this.map.house.supply.x, 0, this.map.house.supply.y);
        this.terrain.add(root);
        this.mesh(root, 0x886548, 0, 4, 0, 21, 8, 16);
        const lid = this.mesh(root, 0xb78b59, 0, 9, 0, 23, 2, 17);
        this.houseCrate = { root, lid };
        continue;
      }
      this.mesh(this.terrain, b.color, b.x, 0, b.y, b.halfWidth * 2, 1, b.halfHeight * 2);
      const roof = this.mesh(this.terrain, b.color, b.x, 38, b.y, b.halfWidth * 2 + 6, 7, b.halfHeight * 2 + 6);
      this.roofs.push(roof);
      this.addCutaway(roof);
    }
    const houseLayout = this.map.house;
    const house = houseLayout && this.map.buildings.find(b => b.doorId === houseLayout.doorId);
    for (const wall of [...this.map.walls, ...this.map.windows]) {
      const dx = wall.x2 - wall.x1;
      const dz = wall.y2 - wall.y1;
      const isHouse = house && Math.max(Math.abs(wall.x1 - house.x), Math.abs(wall.x2 - house.x)) <= house.halfWidth
        && Math.max(Math.abs(wall.y1 - house.y), Math.abs(wall.y2 - house.y)) <= house.halfHeight;
      const height = wall.blocksVision ? (isHouse ? 39 : 34) : (isHouse ? 13 : 15);
      const mesh = this.mesh(this.terrain, wall.blocksVision ? (isHouse ? 0xc2ae90 : 0x9a917c) : (isHouse ? 0xa29279 : 0x6d9ba0),
        (wall.x1 + wall.x2) / 2, height / 2, (wall.y1 + wall.y2) / 2,
        Math.hypot(dx, dz), height, 8);
      mesh.rotation.y = -Math.atan2(dz, dx);
      this.addCutaway(mesh);
      if (isHouse && !wall.blocksVision) {
        const x = (wall.x1 + wall.x2) / 2;
        const z = wall.y1;
        const width = Math.abs(dx);
        this.addCutaway(this.mesh(this.terrain, 0xc2ae90, x, 35, z, width, 8, 8));
        for (const level of [14, 30]) this.addCutaway(this.mesh(this.terrain, 0x455b58, x, level, z, width, 2, 9));
        this.addCutaway(this.mesh(this.terrain, 0x455b58, x, 22, z, 2, 16, 7));
      }
    }
    this.terrain.updateMatrixWorld(true);
    this.propBatches = buildStaticPropBatches(this.terrain, world.props, this.cube, this.head,
      color => this.materialFor(color));
  }

  private drawDoor(door: BuildableStructureSnapshot, active: Set<string>): void {
    const key = 'door:' + door.id;
    active.add(key);
    let model = this.meshes.get(key);
    if (!model) {
      model = new T.Group();
      const isHouse = door.id === this.map?.house?.doorId;
      this.mesh(model, isHouse ? 0x50706a : 0x956840, door.radius, 15, 0, door.radius * 2, 30, 7);
      if (isHouse) {
        this.mesh(model, 0x314d48, door.radius, 19, 4.2, door.radius * 1.5, 13, 1.4);
        this.mesh(model, 0xb09a63, door.radius * 1.72, 12, 4.6, 4, 2, 2);
      }
      this.actors.add(model);
      this.meshes.set(key, model);
    }
    model.visible = door.hp > 0;
    model.position.set(door.x - door.radius, 0, door.y);
    model.rotation.y = door.open ? Math.PI / 2 : 0;
  }

  private buildZombieProxy(): T.BufferGeometry {
    const parts = [
      this.body.clone().scale(23, 22, 19).translate(0, 15, 0),
      this.head.clone().scale(13, 13, 13).translate(2, 31, 0),
      this.cube.clone().scale(15, 6, 7).translate(10, 22, -9),
      this.cube.clone().scale(15, 6, 7).translate(10, 22, 9),
      this.cube.clone().scale(7, 11, 6).translate(-1, 6, -4),
      this.cube.clone().scale(7, 11, 6).translate(0, 6, 4),
    ].map(part => {
      if (!part.index) return part;
      const geometry = part.toNonIndexed();
      part.dispose();
      return geometry;
    });
    const geometry = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    return geometry;
  }

  private createActorProxy(color: number, zombie: boolean): T.Group {
    const model = new T.Group();
    if (zombie) {
      this.mesh(model, color, 0, 0, 0, 1, 1, 1, this.zombieProxy);
      return model;
    }
    this.mesh(model, 0x252d28, 0, 15, 0, 28, 28, 22, this.body);
    this.mesh(model, color, -4, 25, 0, 20, 15, 24, this.body);
    this.mesh(model, 0xb9a28c, 3, 31, 0, 14, 14, 14, this.head);
    this.mesh(model, color, 9, 22, -10, 15, 7, 6);
    this.mesh(model, color, 9, 22, 10, 15, 7, 6);
    return model;
  }

  consumeCharacterEvents(events: readonly GameEvent[], world: World): void {
    this.characters.consume(events, world);
  }

  render(world: World, projection: GroundProjection, cssWidth: number, cssHeight: number, deltaMs: number,
         visible: (x: number, y: number, radius: number) => boolean): void {
    if (!this.available || cssWidth <= 0 || cssHeight <= 0) return;
    if (this.seed !== world.seed) {
      this.buildTerrain(world);
      this.actors.clear();
      this.meshes.clear();
    }
    const canvas = this.renderer.domElement;
    const quality = this.quality.profile;
    const ratio = Math.min(devicePixelRatio, quality.dprCap) * quality.scale;
    if (ratio !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(ratio);
    const fog = quality.name === 'Economia' ? this.lowFogMap : this.fogMap;
    if (this.fogDirty || this.fogUniform.value !== fog) {
      this.fogUniform.value = fog;
      if (fog === this.lowFogMap) {
        const { width, height } = this.lowFogContext.canvas;
        this.lowFogContext.globalCompositeOperation = 'copy';
        this.lowFogContext.drawImage(this.fogCanvas, 0, 0, width, height);
      }
      fog.needsUpdate = true;
      this.fogDirty = false;
    }
    if (this.width !== cssWidth || this.height !== cssHeight) {
      this.width = cssWidth;
      this.height = cssHeight;
      this.renderer.setSize(this.width, this.height, false);
    }
    canvas.style.visibility = 'visible';
    const view = projection.ground;
    this.camera.left = -view.width / 2;
    this.camera.right = view.width / 2;
    this.camera.top = view.height / 2;
    this.camera.bottom = -view.height / 2;
    const center = projection.center;
    const offset = projection.cameraOffset(900);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(center.x + offset.x, offset.y, center.y + offset.z);
    this.camera.lookAt(center.x, 0, center.y);
    this.camera.updateProjectionMatrix();

    const local = world.players.find(p => p.id === world.localPlayerId);
    this.map?.buildings.forEach((b, i) => {
      this.roofs[i].visible = !local || Math.abs(local.x - b.x) >= b.halfWidth || Math.abs(local.y - b.y) >= b.halfHeight;
    });
    if (this.houseCrate) {
      const crate = world.lootContainers?.find(item => item.label === 'Casa');
      this.houseCrate.root.visible = Boolean(crate);
      this.houseCrate.lid.position.set(0, crate?.opened ? 14 : 9, crate?.opened ? -7 : 0);
      this.houseCrate.lid.rotation.x = crate?.opened ? Math.PI / 3 : 0;
    }
    this.updateCutaways(local, this.offset.set(offset.x, offset.y, offset.z), deltaMs);
    const active = new Set<string>();
    this.characters.update(world, visible, deltaMs, {
      ...quality,
      pixelsPerUnit: cssHeight * ratio / view.height,
    }, (x, y, radius) => {
      const point = projection.worldToScreen({ x, y }, view);
      const padding = radius * 3 + 12;
      return point.x >= view.x - padding && point.x <= view.x + view.width + padding &&
             point.y >= view.y - padding && point.y <= view.y + view.height + padding;
    });
    for (const structure of world.structures ?? []) {
      if (structure.kind === 'map_door' || structure.kind === 'shelter_door') {
        this.drawDoor(structure, active);
      } else if (structure.kind === 'shelter_wall' && structure.hp > 0) {
        const key = 'wall:' + structure.id;
        active.add(key);
        if (!this.meshes.has(key)) {
          const model = new T.Group();
          model.position.set(structure.x, 0, structure.y);
          model.rotation.y = structure.rotation;
          this.mesh(model, 0x986947, 0, 15, 0, 8, 30, structure.radius * 2);
          this.actors.add(model);
          this.meshes.set(key, model);
        }
      }
    }
    for (const [key, model] of this.meshes) {
      if (!active.has(key)) {
        this.actors.remove(model);
        this.meshes.delete(key);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  setQualityMode(mode: QualityMode): void {
    this.quality.setMode(mode);
  }

  sampleFrame(deltaMs: number): void {
    this.quality.sample(deltaMs);
  }

  resetQualitySampling(): void {
    this.quality.resetSampling();
  }

  resetActors(): void {
    this.characters.reset();
    this.actors.clear();
    this.meshes.clear();
  }

  get available(): boolean {
    return !this.renderer.getContext().isContextLost();
  }

  getCounters(): GraphicsCounters {
    const { render, memory, programs } = this.renderer.info;
    return {
      calls: render.calls,
      triangles: render.triangles,
      ...memory,
      programs: programs?.length ?? 0,
      pixelRatio: this.renderer.getPixelRatio(),
      animatedActors: this.characters.animatedCount,
      quality: this.quality.profile.name,
    };
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onAvailabilityChange);
    this.clearCutaways();
    this.propBatches.forEach(batch => batch.dispose());
    this.zombieProxy.dispose();
    for (const geometry of this.houseGeometries) geometry.dispose();
    this.characters.dispose();
    this.fogMap.dispose();
    this.lowFogMap.dispose();
    this.cube.dispose();
    this.body.dispose();
    this.head.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
