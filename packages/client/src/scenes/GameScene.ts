import { drawLootContainer, drawLootItem } from '../render/LootArt.js';
import { GameAudio } from '../audio/GameAudio.js';
import { WorldRenderer3D } from '../render/WorldRenderer3D.js';
import type { QualityMode } from '../render/GraphicsQuality.js';
import { GroundProjection } from '../render/GroundProjection.js';
import { IsometricView } from '../render/IsometricView.js';
import { FrameProfiler } from '../render/FrameProfiler.js';
import type { RenderWorldState } from '../network/WorldProvider.js';
import Phaser from 'phaser';
import {
  BALANCE,
  buildObstaclesFromProps,
  SUPPLY_SLOTS,
  getStructureDefinition,
  hasLineOfSight,
  generateUrbanMap,
  canAffordStructure,
  computeVisionPolygon,
  getAmmoLabel,
  getWeaponDefinition,
  isPointInVisionCone,
  normalizeInputVector,
  type AimMode,
  type AmmoType,
  type BuildableStructureSnapshot,
  type EquippedSlotId,
  type GameMode,
  type LootContainerSnapshot,
  type PlayerStateSnapshot,
  type PropData,
  type PropKind,
  type ResourceKind,
  type SegmentObstacle,
  type StructureKind,
  type Vec2,
  type VisionObstacles,
  type WeaponId,
  type WorldLootItemSnapshot,
  type ZombieKind,
} from '@zombie-coop/shared';
import { TEXTURE_KEYS, TEXTURE_SCALE } from '../assets/textureGenerator.js';
import { KeyboardController } from '../input/KeyboardController.js';
import { VirtualJoystick } from '../input/VirtualJoystick.js';
import { OfflineProvider } from '../network/OfflineProvider.js';
import { OnlineProvider } from '../network/OnlineProvider.js';
import type { FrameAimInput, IWorldProvider } from '../network/WorldProvider.js';
import { CombatEffectsManager } from '../ui/CombatEffects.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { EndGameModal, formatSurvivalTime } from '../ui/EndGameModal.js';
import { LobbyOverlay } from '../ui/LobbyOverlay.js';
import { Minimap } from '../ui/Minimap.js';
import { UpgradePickerOverlay } from '../ui/UpgradePickerOverlay.js';

const FOG_TEX_KEY = 'fog_of_war_canvas_tex';
const FOG_TEX_SIZE = 1024; // Textura de alta definição (1024x1024) para bordas nítidas no cone de visão e sombras
const FOG_GRID_COLS = Math.ceil(BALANCE.MAP.WIDTH / BALANCE.VISION.FOG_CELL_SIZE_PX);
const FOG_GRID_ROWS = Math.ceil(BALANCE.MAP.HEIGHT / BALANCE.VISION.FOG_CELL_SIZE_PX);

interface DangerPingMarker {
  x: number;
  y: number;
  remainingMs: number;
}

export class GameScene extends Phaser.Scene {
  private provider!: IWorldProvider;
  private keyboard!: KeyboardController;
  private joystick!: VirtualJoystick;
  private combatEffects!: CombatEffectsManager;
  private endGameModal!: EndGameModal;
  private lobbyOverlay!: LobbyOverlay;
  private debugOverlay!: DebugOverlay;
  private upgradePicker!: UpgradePickerOverlay;

  private defaultSeed: number = BALANCE.SIMULATION.DEFAULT_SEED;
  private selectedGameMode: GameMode = 'rounds';
  private simulatedLagMs = 0;
  private currentSeedRendered = -1;
  private localAimMode: AimMode = 'auto';
  private logicalWidth: number = BALANCE.VIEWPORT.WIDTH;
  private logicalHeight: number = BALANCE.VIEWPORT.HEIGHT;
  private currentDpr = 1;
  private lastAimVector: Vec2 = { x: 1, y: 0 };

  private readonly playerSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly playerRings = new Map<string, Phaser.GameObjects.Arc>();
  private readonly zombieSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly zombieFlashTimers = new Map<number, number>();
  private readonly propEntries: Array<{
    prop: PropData;
    image: Phaser.GameObjects.Image;
  }> = [];

  private visionObstacles: VisionObstacles = { circles: [], segments: [] };
  private readonly extraWallSegments: SegmentObstacle[] = [];
  private readonly exploredCellsGrid = new Uint8Array(FOG_GRID_COLS * FOG_GRID_ROWS);
  private exploredCellsCount = 0;
  private exploredCanvas!: HTMLCanvasElement;
  private minimap!: Minimap;
  private exploredCtx!: CanvasRenderingContext2D;
  private fogTexture!: Phaser.Textures.CanvasTexture;
  private world3D?: WorldRenderer3D;
  private projection?: GroundProjection;
  private readonly isometricView = new IsometricView();
  private isometricProjection?: GroundProjection;
  private presentationDeltaMs = 0;
  private finalPresentation?: RenderWorldState;
  private finalPresentationMs = 0;
  private zoomButton!: HTMLButtonElement;
  private pendingPresentation?: RenderWorldState;
  private profiler?: FrameProfiler;
  private ground!: Phaser.GameObjects.TileSprite;
  private arenaGraphics!: Phaser.GameObjects.Graphics;
  private fogImage!: Phaser.GameObjects.Image;
  private pauseButton!: HTMLButtonElement;
  private pauseDialog!: HTMLDialogElement;
  private offlinePaused = false;
  private graphicsMode: QualityMode = 'auto';
  private get batterySaver(): boolean {
    return this.graphicsMode === 'economy';
  }
  private audio!: GameAudio;
  private graphicsButton!: HTMLButtonElement;
  private hudStack!: HTMLDivElement;
  private utilityPanel!: HTMLDetailsElement;
  private teamStatus!: HTMLDivElement;
  private quickItems!: HTMLDivElement;
  private nextDangerPingAt = 0;
  private readonly touchControls = window.matchMedia('(pointer: coarse)');
  private urbanMap = generateUrbanMap(BALANCE.SIMULATION.DEFAULT_SEED);
  private readonly buildingLabels: Phaser.GameObjects.Text[] = [];
  private wallSegmentsGraphics!: Phaser.GameObjects.Graphics;
  private dangerPingGraphics!: Phaser.GameObjects.Graphics;
  private dangerPing: DangerPingMarker | null = null;

  private zombieHpGraphics!: Phaser.GameObjects.Graphics;
  private lootGraphics!: Phaser.GameObjects.Graphics;
  private reviveGraphics!: Phaser.GameObjects.Graphics;
  private propsGroup!: Phaser.GameObjects.Group;
  private cameraTargetId: string | null = null;

  // Camada de HUD e Controles em DOM Nativo HiDPI (100% na resolução física da tela do aparelho)
  private hudTopPanelEl!: HTMLDivElement;
  private hudStatusTextEl!: HTMLDivElement;
  private hudHpFillEl!: HTMLDivElement;
  private hudXpFillEl!: HTMLDivElement;
  private hudMetricsTextEl!: HTMLDivElement;
  private hudWeaponBarEl!: HTMLDivElement;
  private hudSlotKnifeBtn!: HTMLButtonElement;
  private hudSlot1Btn!: HTMLButtonElement;
  private hudSlot2Btn!: HTMLButtonElement;
  private hudAmmoStatusEl!: HTMLDivElement;
  private hudSurvivalBarEl!: HTMLDivElement;
  private shelterControls!: HTMLDivElement;
  private readonly shelterButtons = new Map<StructureKind, HTMLButtonElement>();
  private inventoryPanel!: HTMLDivElement;
  private supplyRows: Array<{
    quantity: HTMLSpanElement;
    amount: HTMLInputElement;
    drop: HTMLButtonElement;
    share: HTMLButtonElement;
    deposit: HTMLButtonElement;
    withdraw: HTMLButtonElement;
  }> = [];
  private hudResourcesStatusEl!: HTMLDivElement;
  private hudBuildWoodBtn!: HTMLButtonElement;
  private hudBuildTrapBtn!: HTMLButtonElement;
  private hudBuildScrapBtn!: HTMLButtonElement;
  private hudMedkitBtn!: HTMLButtonElement;
  private hudRepairBtn!: HTMLButtonElement;
  private hudReloadBtn!: HTMLButtonElement;
  private hudInteractBtn!: HTMLButtonElement;
  private hudHintBarEl!: HTMLDivElement;
  private allyIndicatorEl!: HTMLDivElement;
  private joystickLayerEl!: HTMLDivElement;
  private leftJoyBaseEl!: HTMLDivElement;
  private leftJoyKnobEl!: HTMLDivElement;
  private leftJoyLabelEl!: HTMLDivElement;
  private rightJoyBaseEl!: HTMLDivElement;
  private rightJoyKnobEl!: HTMLDivElement;
  private rightJoyLabelEl!: HTMLDivElement;

  private hudAimModeBtn!: HTMLButtonElement;
  private hudAttackBtn!: HTMLButtonElement;
  private hudPingDangerBtn!: HTMLButtonElement;
  private hudSkipIntermissionBtn!: HTMLButtonElement;
  private levelUpBannerEl!: HTMLDivElement;
  private levelUpBannerTimerMs = 0;
  private onToggleKeyBound!: (ev: KeyboardEvent) => void;
  private onWindowResizeBound!: () => void;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    const params = new URLSearchParams(window.location.search);
    const seedParam = Number(params.get('seed'));
    this.defaultSeed =
      Number.isInteger(seedParam) && seedParam > 0
        ? seedParam
        : BALANCE.SIMULATION.DEFAULT_SEED;

    if (params.get('gameMode') === 'exploration') {
      this.selectedGameMode = 'exploration';
    } else {
      this.selectedGameMode = 'rounds';
    }

    const lagParam = Number(params.get('lag'));
    this.simulatedLagMs =
      Number.isFinite(lagParam) && lagParam > 0 ? Math.min(2000, Math.round(lagParam)) : 0;

    if (params.get('aim') === 'manual') {
      this.localAimMode = 'manual';
    } else {
      this.localAimMode = this.touchControls.matches ? 'manual' : 'auto';
    }

    try {
      const saved = localStorage.getItem('bit-zombie-graphics-mode');
      this.graphicsMode = saved === 'standard' || saved === 'economy' || saved === 'auto' ? saved
        : localStorage.getItem('bit-zombie-battery-saver') === 'true' ? 'economy' : 'auto';
    } catch {
      this.graphicsMode = 'auto';
    }
    const debugEnabled = params.has('debug');
    this.profiler = debugEnabled ? new FrameProfiler() : undefined;
    this.projection = undefined;
    this.isometricProjection = undefined;
    this.isometricView.resetFollow();
    this.pendingPresentation = undefined;
    this.finalPresentation = undefined;
    this.finalPresentationMs = 0;

    this.provider = new OfflineProvider(
      'player-1',
      this.defaultSeed,
      this.selectedGameMode,
      this.profiler?.recordStep
    );
    this.currentSeedRendered = -1;
    this.cameraTargetId = null;
    this.playerSprites.clear();
    this.playerRings.clear();
    this.zombieSprites.clear();
    this.zombieFlashTimers.clear();
    this.propEntries.length = 0;
    this.extraWallSegments.length = 0;

    const state = this.readRenderState();
    const { mapWidth, mapHeight } = state;

    // 1. Piso com ruído e manchas (4000x4000) usando textura supersampled 3x HiDPI
    const ground = this.add.tileSprite(0, 0, mapWidth, mapHeight, TEXTURE_KEYS.GROUND_TILE);
    ground.setOrigin(0, 0);
    ground.setTileScale(1 / TEXTURE_SCALE, 1 / TEXTURE_SCALE);
    ground.setDepth(0);
    this.ground = ground;
    this.world3D = undefined;
    this.game.canvas.dataset.worldRenderer = 'phaser';
    this.initFogOfWarLayers(mapWidth, mapHeight);
    const parent = this.game.canvas.parentElement;
    if (parent && params.get('renderer') !== '2d') {
      try {
        parent.style.position = 'relative';
        this.game.canvas.style.position = 'relative';
        this.game.canvas.style.zIndex = '1';
        this.world3D = new WorldRenderer3D(parent, this.fogTexture.getCanvas(), () => this.syncWorldRender(0));
        this.world3D.setQualityMode(this.graphicsMode);
      } catch {
        // Mantém o renderizador 2D quando WebGL2 não puder ser inicializado.
      }
    }

    // 2. Grade tática sutil e limites visíveis da arena (4000x4000)
    this.drawArenaBoundariesAndLandmarks(mapWidth, mapHeight);

    // 3. Props decorativos e obstáculos determinísticos
    this.propsGroup = this.add.group();
    this.wallSegmentsGraphics = this.add.graphics();
    this.wallSegmentsGraphics.setDepth(6);
    this.renderPropsForSeed(state.seed, state.props);

    // 5. Barra de vida dos zumbis, loot/recipientes, laser de mira manual, zona de resgate e efeitos de combate
    this.lootGraphics = this.add.graphics();
    this.lootGraphics.setDepth(7);
    this.reviveGraphics = this.add.graphics();
    this.reviveGraphics.setDepth(8);
    this.dangerPingGraphics = this.add.graphics();
    this.dangerPingGraphics.setDepth(15);
    this.zombieHpGraphics = this.add.graphics();
    this.zombieHpGraphics.setDepth(13);
    this.combatEffects = new CombatEffectsManager(this);

    // 6. Configura limites da câmera top-down
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

    // 7. Inicializa controladores de entrada (WASD/Setas + Twin-Stick Virtual: Esquerda Mover, Direita Mirar)
    const mountEl = document.getElementById('app') ?? document.body;
    this.keyboard = new KeyboardController();
    this.joystick = new VirtualJoystick(
      mountEl,
      this.logicalWidth,
      this.logicalHeight,
      this.game.canvas
    );

    // 8. Camada de HUD Nativa HiDPI, Botões Táticos, Seletor de Upgrades, Banner, Modal de Fim de Jogo e Lobby
    this.createHudOverlay();
    this.minimap = new Minimap(this.hudStack);
    this.createHudDomControls();
    this.createPauseControls();
    this.createMobileHud();
    this.audio = new GameAudio();
    const sound = document.createElement('button');
    sound.type = 'button';
    sound.className = 'mobile-graphics';
    const syncSoundLabel = () => {
      sound.textContent = this.audio.isMuted ? 'Som desligado' : 'Som ligado';
      sound.setAttribute('aria-pressed', String(!this.audio.isMuted));
    };
    syncSoundLabel();
    sound.addEventListener('click', () => {
      this.audio.toggle();
      syncSoundLabel();
    });
    const controls = document.createElement('p');
    controls.className = 'controls-summary';
    controls.textContent = this.touchControls.matches
      ? 'Joystick esquerdo: mover. Direito: mirar. Segure Atacar e arraste para ajustar a mira.'
      : 'WASD: mover · Mouse: mirar · Clique: atacar · E: interagir · R: recarregar · M: modo de mira';
    this.utilityPanel.append(sound, controls);
    this.zoomButton = document.createElement('button');
    this.zoomButton.type = 'button';
    this.zoomButton.textContent = 'Zoom 100%';
    this.zoomButton.hidden = !this.world3D?.available;
    this.zoomButton.addEventListener('click', () => this.adjustZoom());
    this.utilityPanel.append(this.zoomButton);
    this.upgradePicker = new UpgradePickerOverlay((upgradeId) => {
      this.provider.chooseUpgrade?.(upgradeId);
      this.processTransientEvents();
      this.syncWorldRender(0);
    });
    this.endGameModal = new EndGameModal(() => this.handleRestartMatch());
    this.debugOverlay = new DebugOverlay(debugEnabled);
    this.lobbyOverlay = new LobbyOverlay(
      {
        onStartOffline: (gameMode, seed) => this.startOfflineMode(gameMode, seed),
        onCreatePrivateRoom: (gameMode, seed) =>
          this.handleCreatePrivateRoom(gameMode, seed),
        onJoinPrivateRoom: (code) => this.handleJoinPrivateRoom(code),
        onToggleReady: () => this.provider.setReady?.(),
        onLeaveRoom: () => this.handleLeaveRoomToMenu(),
        onChangeAimMode: (mode) => this.setAimMode(mode),
        onChangeGameMode: (mode) => {
          this.selectedGameMode = mode;
        },
      },
      this.defaultSeed,
      this.selectedGameMode
    );
    this.lobbyOverlay.setAimMode(this.localAimMode);

    // Ajusta orientação e resolução física HiDPI (devicePixelRatio) e escuta redimensionamento
    this.syncViewportOrientation();
    this.onWindowResizeBound = () => {
      this.syncViewportOrientation();
      this.world3D?.resetQualitySampling();
      this.syncWorldRender(0);
      this.profiler?.reset();
    };
    window.addEventListener('resize', this.onWindowResizeBound);
    this.game.canvas.addEventListener('wheel', this.onZoomWheel, { passive: false });

    // Se ?mode=offline ou ?autostart=1 estiver na URL, inicia direto no modo offline
    if (params.get('mode') === 'offline' || params.get('autostart') === '1') {
      this.startOfflineMode(this.selectedGameMode, this.defaultSeed);
    } else {
      this.lobbyOverlay.showMenu();
    }

    // Atalhos de teclado: M alterna modo de tiro, N antecipa intervalo, Q sinaliza perigo, 1/2/3 troca arma, R recarrega, E coleta/abre
    this.onToggleKeyBound = (ev: KeyboardEvent) => {
      if (ev.code === 'Escape' && this.canPauseOffline() && !ev.repeat) {
        ev.preventDefault();
        this.setOfflinePaused(!this.offlinePaused);
        return;
      }
      if (this.offlinePaused || this.lobbyOverlay.isVisible() || this.endGameModal.isVisible()) {
        return;
      }
      if (ev.code === 'KeyM') {
        this.setAimMode(this.localAimMode === 'auto' ? 'manual' : 'auto');
      } else if (ev.code === 'KeyN') {
        this.provider.skipRoundIntermission?.();
        this.processTransientEvents();
        this.syncWorldRender(0);
      } else if (ev.code === 'KeyQ') {
        this.triggerDangerPing();
      } else if (ev.code === 'Digit1') {
        this.provider.switchWeaponSlot?.('knife');
        this.syncWorldRender(0);
      } else if (ev.code === 'Digit2') {
        this.provider.switchWeaponSlot?.('slot1');
        this.syncWorldRender(0);
      } else if (ev.code === 'Digit3') {
        this.provider.switchWeaponSlot?.('slot2');
        this.syncWorldRender(0);
      } else if (ev.code === 'KeyR') {
        this.provider.reloadWeapon?.();
        this.syncWorldRender(0);
      } else if (ev.code === 'KeyE') {
        this.provider.interactLoot?.();
        this.processTransientEvents();
        this.syncWorldRender(0);
      } else if (ev.code === 'KeyB') {
        this.provider.buildStructure?.('wood_barricade');
        this.processTransientEvents();
        this.syncWorldRender(0);
      } else if (ev.code === 'KeyV') {
        this.provider.buildStructure?.('spike_trap');
        this.processTransientEvents();
        this.syncWorldRender(0);
      } else if (ev.code === 'KeyG') {
        this.provider.buildStructure?.('scrap_barricade');
        this.processTransientEvents();
        this.syncWorldRender(0);
      } else if (ev.code === 'KeyH') {
        this.provider.useMedkit?.();
        this.processTransientEvents();
        this.syncWorldRender(0);
      } else if (ev.code === 'KeyX') {
        this.provider.repairStructure?.();
        this.processTransientEvents();
        this.syncWorldRender(0);
      }
    };
    window.addEventListener('keydown', this.onToggleKeyBound);

    // Hooks de inspeção/teste para verificação automatizada
    const win = window as unknown as Record<string, unknown>;
    win.__triggerTestGameOver = () => {
      if (this.provider instanceof OfflineProvider) {
        this.provider.forceLocalPlayerDefeatForTest();
      }
    };
    win.__awardTestXp = (amount: number) => {
      if (this.provider instanceof OfflineProvider) {
        this.provider.awardXpForTest(amount);
        this.processTransientEvents();
        this.syncWorldRender(0);
      }
    };
    win.__setAimMode = (mode: AimMode) => {
      this.setAimMode(mode);
    };
    win.__setAimDirection = (aimX: number, aimY: number) => {
      this.joystick.setAimDirection(aimX, aimY);
      const norm = normalizeInputVector(aimX, aimY);
      if (norm.x !== 0 || norm.y !== 0) {
        this.lastAimVector = norm;
      }
    };
    win.__setAttackHeld = (held: boolean) => {
      this.joystick.setAttackButtonHeld(Boolean(held));
    };
    win.__spawnTestZombie = (
      kind: ZombieKind,
      x: number,
      y: number
    ) => {
      if (this.provider instanceof OfflineProvider) {
        const zId = this.provider.spawnZombieForTest(kind, x, y);
        this.syncWorldRender(0);
        return zId;
      }
      return null;
    };
    win.__addTestWall = (x1: number, y1: number, x2: number, y2: number) => {
      this.extraWallSegments.push({
        x1,
        y1,
        x2,
        y2,
        blocksVision: true,
        blocksProjectiles: true,
      });
      if (this.provider instanceof OfflineProvider) {
        this.provider.addWallSegmentForTest(x1, y1, x2, y2);
      }
      const curState = this.readRenderState();
      this.visionObstacles = buildObstaclesFromProps(
        curState.props,
        this.extraWallSegments
      );
      this.drawWallSegments();
      this.syncWorldRender(0);
    };
    win.__skipRoundIntermission = () => {
      this.provider.skipRoundIntermission?.();
      this.processTransientEvents();
      this.syncWorldRender(0);
    };
    win.__startMode = (gameMode: GameMode, seed?: number) => {
      this.startOfflineMode(gameMode, seed ?? this.defaultSeed);
    };
    win.__fastForwardTicks = (
      ticks: number,
      dx = 0,
      dy = 0,
      customAim?: FrameAimInput
    ) => {
      for (let i = 0; i < ticks; i += 1) {
        this.provider.updateFrame(
          BALANCE.SIMULATION.TICK_DT_MS,
          { x: dx, y: dy },
          customAim ?? this.readAimInput({ x: dx, y: dy })
        );
        const state = this.readRenderState();
        this.processTransientEvents(state);
        const localPlayer = state.players.find((p) => p.id === state.localPlayerId);
        this.combatEffects.update(16, (px, py) =>
          this.isWorldPointVisibleToLocalPlayer(px, py, 6, localPlayer)
        );
      }
      this.syncWorldRender(16);
    };
    win.__testJoinWithProtocolMismatch = async (code: string) => {
      try {
        await OnlineProvider.joinPrivateRoomByCode(code, this.simulatedLagMs, {}, 999);
      } catch (err) {
        this.lobbyOverlay.showMenu((err as Error).message);
      }
    };
    win.__simulateTransportDrop = () => {
      if (this.provider instanceof OnlineProvider) {
        this.provider.simulateTransportDropForTest();
      }
    };
    win.__chooseUpgrade = (upgradeId: string) => {
      this.provider.chooseUpgrade?.(upgradeId);
      this.processTransientEvents();
      this.syncWorldRender(0);
    };
    win.__spawnDownedAlly = (x?: number, y?: number) => {
      if (this.provider instanceof OfflineProvider) {
        this.provider.spawnDownedAllyForTest(x, y);
        this.processTransientEvents();
        this.syncWorldRender(0);
      }
    };
    win.__giveTestWeapon = (weaponId: WeaponId) => {
      if (this.provider instanceof OfflineProvider) {
        const ok = this.provider.giveWeaponForTest(weaponId);
        this.syncWorldRender(0);
        return ok;
      }
      return false;
    };
    win.__spawnTestLoot = (options: {
      x: number;
      y: number;
      kind: 'weapon' | 'ammo';
      weaponId?: WeaponId;
      ammoType?: Exclude<AmmoType, 'none'>;
      ammoAmount?: number;
      label?: string;
    }) => {
      if (this.provider instanceof OfflineProvider) {
        const id = this.provider.spawnLootForTest(options);
        this.syncWorldRender(0);
        return id;
      }
      return null;
    };
    win.__switchWeaponSlot = (slot: EquippedSlotId) => {
      this.provider.switchWeaponSlot?.(slot);
      this.syncWorldRender(0);
    };
    win.__reloadWeapon = () => {
      this.provider.reloadWeapon?.();
      this.syncWorldRender(0);
    };
    win.__interactLoot = () => {
      this.provider.interactLoot?.();
      this.processTransientEvents();
      this.syncWorldRender(0);
    };
    win.__buildStructure = (kind: StructureKind) => {
      this.provider.buildStructure?.(kind);
      this.processTransientEvents();
      this.syncWorldRender(0);
    };
    win.__repairStructure = () => {
      this.provider.repairStructure?.();
      this.processTransientEvents();
      this.syncWorldRender(0);
    };
    win.__useMedkit = () => {
      this.provider.useMedkit?.();
      this.processTransientEvents();
      this.syncWorldRender(0);
    };
    win.__addTestResource = (kind: ResourceKind, amount: number) => {
      if (this.provider instanceof OfflineProvider) {
        this.provider.addResourceForTest(kind, amount);
        this.syncWorldRender(0);
      }
    };

    const worldCamera = this.cameras.main;
    worldCamera.on(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.applyGroundProjection, this);
    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.presentWorld, this);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // 9. Agenda a apresentação do estado inicial
    this.syncWorldRender(0);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.POST_RENDER, this.presentWorld, this);
      worldCamera.off(Phaser.Cameras.Scene2D.Events.PRE_RENDER, this.applyGroundProjection, this);
      this.game.canvas.removeEventListener('wheel', this.onZoomWheel);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.pendingPresentation = undefined;
      this.world3D?.dispose();
      this.audio.dispose();
      window.removeEventListener('keydown', this.onToggleKeyBound);
      window.removeEventListener('resize', this.onWindowResizeBound);
      void this.provider.disconnect?.();
      this.keyboard.destroy();
      this.joystick.destroy();
      this.upgradePicker.destroy();
      this.endGameModal.destroy();
      this.lobbyOverlay.destroy();
      this.debugOverlay.destroy();
      this.minimap.destroy();
      this.hudStack.remove();
      this.hudWeaponBarEl.remove();
      this.hudSurvivalBarEl.remove();
      this.hudRepairBtn.remove();
      this.hudReloadBtn.remove();
      this.hudInteractBtn.remove();
      this.pauseDialog.remove();
      this.pauseButton.remove();
      this.quickItems.remove();
      this.hudHintBarEl.remove();
      this.allyIndicatorEl.remove();
      this.joystickLayerEl.remove();
      this.hudAimModeBtn.remove();
      this.hudAttackBtn.remove();
      this.hudPingDangerBtn.remove();
      this.hudSkipIntermissionBtn.remove();
      this.levelUpBannerEl.remove();
      this.combatEffects.clearAll();
    });
  }

  update(_time: number, deltaMs: number): void {
    const isBlockedByUi = this.endGameModal.isVisible() || this.lobbyOverlay.isVisible();
    if (this.offlinePaused || (this.provider.mode === 'offline' && isBlockedByUi)) {
      this.profiler?.suspend();
      this.world3D?.resetQualitySampling();
      if (!this.offlinePaused && this.finalPresentation && this.finalPresentationMs > 0) {
        this.presentationDeltaMs = Math.min(100, this.game.loop.rawDelta);
        this.finalPresentationMs -= this.presentationDeltaMs;
        this.pendingPresentation = this.finalPresentation;
      }
      return;
    }
    if (isBlockedByUi || document.hidden) this.profiler?.suspend();
    else this.profiler?.begin();
    if (isBlockedByUi || document.hidden) this.world3D?.resetQualitySampling();
    else this.world3D?.sampleFrame(this.game.loop.rawDelta);
    const combinedInput = isBlockedByUi ? { x: 0, y: 0 } : this.readCombinedInput();
    const aimInput = isBlockedByUi
      ? {
          aimMode: this.localAimMode,
          aimX: this.lastAimVector.x,
          aimY: this.lastAimVector.y,
          firing: false,
        }
      : this.readAimInput(combinedInput);

    if (this.profiler) {
      this.profiler.measure('provider', () => this.provider.updateFrame(deltaMs, combinedInput, aimInput));
    } else {
      this.provider.updateFrame(deltaMs, combinedInput, aimInput);
    }
    const state = this.readRenderState();
    if (!isBlockedByUi) this.audio.update(state);
    this.processTransientEvents(state);
    const localPlayer = state.players.find((p) => p.id === state.localPlayerId);
    this.combatEffects.update(deltaMs, (px, py) =>
      this.isWorldPointVisibleToLocalPlayer(px, py, 6, localPlayer)
    );
    this.updateLevelUpBanner(deltaMs);
    this.updateDangerPing(deltaMs);
    this.syncWorldRender(deltaMs, state, this.game.loop.rawDelta);
    this.drawJoystickOverlay();
  }

  /**
   * Adapta dinamicamente a resolução do canvas à proporção exata e ao `devicePixelRatio` (HiDPI/Retina)
   * da tela de cada aparelho (`window.innerWidth x window.innerHeight`), mantendo:
   * - O campo de visão lógico constante (diagonal lógica ~1101.4 px, meia-diagonal ~550.7 px < 580 px do anel de spawn).
   * - O buffer físico WebGL renderizado em alta definição (`canvasW = targetW * dpr`, `canvasH = targetH * dpr`)
   *   com `cameras.main.setZoom(dpr)` para nitidez total em celulares e monitores de alta densidade.
   */
  private syncViewportOrientation(): void {
    const winW = Math.max(1, window.innerWidth);
    const winH = Math.max(1, window.innerHeight);
    const isPortrait = winH > winW;

    const baseDiag = Math.hypot(BALANCE.VIEWPORT.WIDTH, BALANCE.VIEWPORT.HEIGHT);
    const screenDiag = Math.hypot(winW, winH);
    const scaleFactor = baseDiag / screenDiag;

    const targetW = Math.max(320, Math.round(winW * scaleFactor));
    const targetH = Math.max(320, Math.round(winH * scaleFactor));

    // Calcula o multiplicador para que o framebuffer WebGL tenha no mínimo a resolução física da tela (DPR nativo)
    const rawDpr = Math.min(
      this.batterySaver ? 1 : BALANCE.VIEWPORT.MAX_DPR,
      Math.max(1, window.devicePixelRatio || 1)
    );
    const physicalW = Math.round(winW * rawDpr);
    const renderScale = Math.min(
      BALANCE.VIEWPORT.MAX_DPR,
      Math.max(rawDpr, physicalW / targetW)
    );

    const canvasW = Math.round(targetW * renderScale);
    const canvasH = Math.round(targetH * renderScale);

    document.body.dataset.orientation = isPortrait ? 'portrait' : 'landscape';
    document.body.dataset.viewportW = String(targetW);
    document.body.dataset.viewportH = String(targetH);
    document.body.dataset.canvasW = String(canvasW);
    document.body.dataset.canvasH = String(canvasH);
    document.body.dataset.dpr = renderScale.toFixed(2);

    this.scale.setParentSize(winW, winH);

    if (
      this.logicalWidth !== targetW ||
      this.logicalHeight !== targetH ||
      Math.abs(this.currentDpr - renderScale) > 0.01
    ) {
      this.logicalWidth = targetW;
      this.logicalHeight = targetH;
      this.currentDpr = renderScale;
      this.scale.setGameSize(canvasW, canvasH);
      this.cameras.main.setSize(canvasW, canvasH);
      this.cameras.main.setZoom(renderScale);
      this.joystick.setLogicalViewport(targetW, targetH);
    }

    this.scale.refresh();

    if (this.game.canvas) {
      this.game.canvas.style.width = `${winW}px`;
      this.game.canvas.style.height = `${winH}px`;
      this.game.canvas.style.marginLeft = '0px';
      this.game.canvas.style.marginTop = '0px';
    }
  }

  private setAimMode(mode: AimMode): void {
    this.localAimMode = mode === 'manual' ? 'manual' : 'auto';
    this.lobbyOverlay?.setAimMode(this.localAimMode);
    this.refreshHudAimModeButton();
    document.body.dataset.aimMode = this.localAimMode;
  }

  /**
   * Lê a orientação da mira (PC Mouse ou Celular Joystick Direito) e o estado de ataque:
   * - O personagem SEMPRE olha na direção da mira (`lastAimVector`), mantendo a última direção
   *   ao soltar o joystick direito no celular.
   * - Girar a mira NÃO dispara sozinho: `firing` só é verdadeiro quando o jogador clica no mouse,
   *   toca/segura o botão dedicado de Ataque (`btn-attack`) ou pressiona `Espaço`/`F`.
   */
  private readAimInput(moveVector: Vec2): FrameAimInput {
    const state = this.readRenderState();
    const localPlayer = state.players.find((p) => p.id === state.localPlayerId);
    const rightStick = this.joystick.getRightAimState();
    const mouse = this.joystick.getMouseClientPosition();
    const firing = this.joystick.isAttackHeld() || this.keyboard.isAttackHeld();

    if (rightStick.active || rightStick.hasAimed) {
      const stick = { x: rightStick.aimX, y: rightStick.aimY };
      const norm = this.isometricProjection?.inputToGround(stick) ?? normalizeInputVector(stick.x, stick.y);
      if (norm.x !== 0 || norm.y !== 0) {
        this.lastAimVector = norm;
      }
    } else if (mouse && localPlayer && this.projection) {
      const rect = this.game.canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && mouse.x >= rect.left && mouse.x <= rect.right &&
          mouse.y >= rect.top && mouse.y <= rect.bottom) {
        const point = this.projection.screenToGround(mouse, rect);
        const dx = point.x - localPlayer.x;
        const dy = point.y - localPlayer.y;
        if (Math.hypot(dx, dy) > 4) {
          this.lastAimVector = normalizeInputVector(dx, dy);
        }
      }
    } else if (moveVector.x !== 0 || moveVector.y !== 0) {
      this.lastAimVector = normalizeInputVector(moveVector.x, moveVector.y);
    }

    return {
      aimMode: this.localAimMode,
      aimX: this.lastAimVector.x,
      aimY: this.lastAimVector.y,
      firing,
    };
  }

  private canPauseOffline(): boolean {
    return this.provider.mode === 'offline' && !this.lobbyOverlay.isVisible() &&
      !this.endGameModal.isVisible() && !this.upgradePicker.isVisible();
  }

  private setOfflinePaused(paused: boolean): void {
    if (paused && !this.canPauseOffline()) return;
    this.offlinePaused = paused;
    if (paused) this.minimap.hide();
    this.keyboard.clear();
    this.joystick.reset();
    if (paused && !this.pauseDialog.open) {
      this.pauseDialog.showModal();
      this.joystickLayerEl.style.display = 'none';
      document.body.dataset.state = 'paused';
    } else if (!paused && this.pauseDialog.open) {
      this.pauseDialog.close();
      document.body.dataset.state = 'playing';
    }
  }

  private createMobileHud(): void {
    this.quickItems = document.createElement('div');
    this.quickItems.className = 'mobile-quick-items';
    this.quickItems.setAttribute('role', 'group');
    this.quickItems.setAttribute('aria-label', 'Itens rápidos');
    this.quickItems.hidden = true;
    if (this.touchControls.matches) {
      for (const button of [this.hudMedkitBtn, this.hudReloadBtn, this.hudInteractBtn, this.hudRepairBtn]) {
        this.quickItems.appendChild(button);
      }
    }
    document.body.appendChild(this.quickItems);

    this.teamStatus = document.createElement('div');
    this.teamStatus.className = 'team-status';
    this.teamStatus.hidden = true;
    this.hudTopPanelEl.appendChild(this.teamStatus);

    this.graphicsButton = document.createElement('button');
    this.graphicsButton.type = 'button';
    this.graphicsButton.className = 'mobile-graphics';
    this.graphicsButton.hidden = true;
    const updateLabel = () => {
      const label = this.graphicsMode === 'auto' ? 'automático' : this.batterySaver ? 'economia' : 'padrão';
      this.graphicsButton.textContent = `Gráficos: ${label}`;
    };
    updateLabel();
    this.graphicsButton.addEventListener('click', () => {
      this.graphicsMode = this.graphicsMode === 'auto' ? 'standard' : this.batterySaver ? 'auto' : 'economy';
      this.world3D?.setQualityMode(this.graphicsMode);
      this.syncViewportOrientation();
      this.profiler?.reset();
      updateLabel();
      try {
        localStorage.setItem('bit-zombie-graphics-mode', this.graphicsMode);
      } catch {
        // A preferência continua aplicada durante esta sessão.
      }
    });
    this.utilityPanel.append(this.graphicsButton, this.hudAimModeBtn);
  }

  private createPauseControls(): void {
    this.pauseButton = document.createElement('button');
    this.pauseButton.type = 'button';
    this.pauseButton.textContent = 'Pausar';
    this.pauseButton.dataset.testid = 'pause-offline';
    Object.assign(this.pauseButton.style, {
      position: 'absolute', top: '4px', right: '6px', pointerEvents: 'auto',
      zIndex: '32', minHeight: '44px', padding: '0 12px', display: 'none',
      background: '#17261d', color: '#e4f1e7', border: '1px solid #577963', borderRadius: '8px',
    });
    this.pauseButton.addEventListener('click', () => this.setOfflinePaused(true));

    this.pauseDialog = document.createElement('dialog');
    this.pauseDialog.className = 'interface-card pause-card';
    this.pauseDialog.setAttribute('aria-labelledby', 'offline-pause-title');
    Object.assign(this.pauseDialog.style, {
      background: '#17261d', color: '#e4f1e7', border: '1px solid #577963',
      borderRadius: '12px', padding: '20px', width: 'min(280px, 80vw)', touchAction: 'auto',
    });
    const title = document.createElement('h2');
    title.id = 'offline-pause-title';
    title.textContent = 'Jogo pausado';
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.textContent = 'Continuar';
    resume.style.minHeight = '44px';
    resume.addEventListener('click', () => this.setOfflinePaused(false));
    this.pauseDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.setOfflinePaused(false);
    });
    this.pauseDialog.append(title, resume);
    this.hudTopPanelEl.appendChild(this.pauseButton);
    document.body.appendChild(this.pauseDialog);
  }

  private startOfflineMode(
    gameMode: GameMode = this.selectedGameMode,
    seed: number = this.defaultSeed
  ): void {
    this.selectedGameMode = gameMode;
    this.defaultSeed = seed;
    void this.provider.disconnect?.();
    this.resetWorldEntities();
    this.provider = new OfflineProvider('player-1', seed, gameMode, this.profiler?.recordStep);
    this.lobbyOverlay.setGameMode(gameMode);
    this.lobbyOverlay.setSeed(seed);
    this.lobbyOverlay.hide();
    this.endGameModal.hide();
    this.syncWorldRender(0);
    document.body.dataset.state = 'playing';
    document.body.dataset.mode = 'offline';
    document.body.dataset.gameMode = gameMode;
  }

  private async handleCreatePrivateRoom(
    gameMode: GameMode = this.selectedGameMode,
    seed: number = this.defaultSeed
  ): Promise<void> {
    try {
      this.selectedGameMode = gameMode;
      this.defaultSeed = seed;
      await this.provider.disconnect?.();
      this.resetWorldEntities();
      const online = await OnlineProvider.createPrivateRoom(
        this.simulatedLagMs,
        {
          onDangerPing: (ping) => this.showTeamPing(ping),
          onConnectionLost: (reason) => {
            this.startOfflineFallbackWithMenuError(reason);
          },
        },
        { gameMode, seed }
      );
      this.provider = online;
      document.body.dataset.mode = 'online';
      document.body.dataset.gameMode = gameMode;
      this.syncWorldRender(0);
    } catch (err) {
      this.lobbyOverlay.showError(
        (err as Error).message || 'Falha ao criar sala privada.'
      );
    }
  }

  private async handleJoinPrivateRoom(code: string): Promise<void> {
    try {
      await this.provider.disconnect?.();
      this.resetWorldEntities();
      const online = await OnlineProvider.joinPrivateRoomByCode(code, this.simulatedLagMs, {
        onDangerPing: (ping) => this.showTeamPing(ping),
        onConnectionLost: (reason) => {
          this.startOfflineFallbackWithMenuError(reason);
        },
      });
      this.provider = online;
      document.body.dataset.mode = 'online';
      this.syncWorldRender(0);
    } catch (err) {
      this.lobbyOverlay.showError(
        (err as Error).message || 'Não foi possível entrar na sala informada.'
      );
    }
  }

  private async handleLeaveRoomToMenu(): Promise<void> {
    await this.provider.disconnect?.();
    this.resetWorldEntities();
    this.provider = new OfflineProvider(
      'player-1',
      this.defaultSeed,
      this.selectedGameMode,
      this.profiler?.recordStep
    );
    this.endGameModal.hide();
    this.lobbyOverlay.showMenu();
    document.body.dataset.mode = 'offline';
    this.syncWorldRender(0);
  }

  private startOfflineFallbackWithMenuError(errorMessage: string): void {
    this.resetWorldEntities();
    this.provider = new OfflineProvider(
      'player-1',
      this.defaultSeed,
      this.selectedGameMode,
      this.profiler?.recordStep
    );
    this.endGameModal.hide();
    this.lobbyOverlay.showMenu(errorMessage);
    document.body.dataset.mode = 'offline';
    this.syncWorldRender(0);
  }

  private resetWorldEntities(): void {
    this.profiler?.reset();
    this.finalPresentation = undefined;
    this.finalPresentationMs = 0;
    this.isometricView.resetFollow();
    this.world3D?.resetActors();
    this.audio.reset();
    this.setOfflinePaused(false);
    this.keyboard.clear();
    this.joystick.reset();
    this.combatEffects.clearAll();
    this.cameraTargetId = null;
    this.levelUpBannerTimerMs = 0;
    this.dangerPing = null;
    this.extraWallSegments.length = 0;
    this.wallSegmentsGraphics?.clear();
    this.dangerPingGraphics?.clear();
    this.resetFogOfWarState();
    this.minimap.hide();

    if (this.levelUpBannerEl) {
      this.levelUpBannerEl.style.display = 'none';
    }
    if (this.hudSkipIntermissionBtn) {
      this.hudSkipIntermissionBtn.style.display = 'none';
    }
    if (this.allyIndicatorEl) {
      this.allyIndicatorEl.style.display = 'none';
    }

    for (const sprite of this.playerSprites.values()) {
      sprite.destroy();
    }
    this.playerSprites.clear();
    for (const ring of this.playerRings.values()) {
      ring.destroy();
    }
    this.playerRings.clear();

    for (const sprite of this.zombieSprites.values()) {
      sprite.destroy();
    }
    this.zombieSprites.clear();
    this.zombieFlashTimers.clear();
    this.zombieHpGraphics.clear();
    this.lootGraphics?.clear();
    this.reviveGraphics?.clear();
    this.upgradePicker?.update([], 0);
  }

  private initFogOfWarLayers(mapWidth: number, mapHeight: number): void {

    this.exploredCanvas = document.createElement('canvas');
    this.exploredCanvas.width = FOG_TEX_SIZE;
    this.exploredCanvas.height = FOG_TEX_SIZE;
    const expCtx = this.exploredCanvas.getContext('2d');
    if (expCtx) {
      this.exploredCtx = expCtx;
    }

    if (this.textures.exists(FOG_TEX_KEY)) {
      this.textures.remove(FOG_TEX_KEY);
    }
    const createdTex = this.textures.createCanvas(
      FOG_TEX_KEY,
      FOG_TEX_SIZE,
      FOG_TEX_SIZE
    );
    if (createdTex) {
      this.fogTexture = createdTex;
    }

    this.fogImage = this.add.image(0, 0, FOG_TEX_KEY);
    this.fogImage.setOrigin(0, 0);
    this.fogImage.setDisplaySize(mapWidth, mapHeight);
    this.fogImage.setDepth(14);

    this.resetFogOfWarState();
  }

  private resetFogOfWarState(): void {
    this.exploredCellsGrid.fill(0);
    this.exploredCellsCount = 0;
    if (this.exploredCtx) {
      this.exploredCtx.clearRect(0, 0, FOG_TEX_SIZE, FOG_TEX_SIZE);
    }
    if (this.fogTexture) {
      const ctx = this.fogTexture.getContext();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, FOG_TEX_SIZE, FOG_TEX_SIZE);
      ctx.fillStyle = 'rgba(4, 7, 6, 0.90)';
      ctx.fillRect(0, 0, FOG_TEX_SIZE, FOG_TEX_SIZE);
      this.refreshFogTexture();
    }
  }

  /**
   * Avalia se um ponto `(x, y)` no mundo está visível dentro do cone de visão atual
   * do jogador local e sem obstrução por paredes ou obstáculos sólidos.
   * No cooperativo, cada jogador possui apenas a própria visão (o parceiro não concede visão através de paredes).
   */
  private isWorldPointVisibleToLocalPlayer(
    x: number,
    y: number,
    targetRadiusPx: number,
    localPlayer: RenderWorldState['players'][number] | undefined
  ): boolean {
    if (!localPlayer) {
      return true;
    }
    return isPointInVisionCone(
      localPlayer.x,
      localPlayer.y,
      localPlayer.facingAngle,
      x,
      y,
      this.visionObstacles,
      {
        coneAngleDeg: BALANCE.VISION.CONE_ANGLE_DEG,
        rangePx: BALANCE.VISION.RANGE_PX,
        closeSenseRadiusPx: BALANCE.VISION.CLOSE_SENSE_RADIUS_PX,
        targetRadiusPx,
      }
    );
  }

  /**
   * Atualiza os 3 estados visuais do mapa (Etapa 2):
   * 1. Área nunca explorada (escura `alpha ~0.90`).
   * 2. Cenário explorado, mas fora da visão atual (escurecido `alpha ~0.52`, exibe apenas piso e props estáticos).
   * 3. Área atualmente visível (cone de `110°` recortado por obstáculos sólidos, `alpha 0` + feixe tático sutil).
   */
  private updateVisionAndFogOfWar(
    localPlayer: ReturnType<IWorldProvider['getRenderState']>['players'][number],
    mapWidth: number,
    mapHeight: number
  ): void {
    const poly = computeVisionPolygon(
      localPlayer.x,
      localPlayer.y,
      localPlayer.facingAngle,
      this.visionObstacles,
      {
        coneAngleDeg: BALANCE.VISION.CONE_ANGLE_DEG,
        rangePx: BALANCE.VISION.RANGE_PX,
        rayCount: BALANCE.VISION.RAY_COUNT,
      }
    );

    // 1. Atualiza malha lógica de células exploradas (50x50 células de 80x80 px)
    const cellSize = BALANCE.VISION.FOG_CELL_SIZE_PX;
    const rangeCells = Math.ceil(BALANCE.VISION.RANGE_PX / cellSize);
    const centerCol = Math.floor(localPlayer.x / cellSize);
    const centerRow = Math.floor(localPlayer.y / cellSize);

    const minCol = Math.max(0, centerCol - rangeCells);
    const maxCol = Math.min(FOG_GRID_COLS - 1, centerCol + rangeCells);
    const minRow = Math.max(0, centerRow - rangeCells);
    const maxRow = Math.min(FOG_GRID_ROWS - 1, centerRow + rangeCells);

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const idx = row * FOG_GRID_COLS + col;
        if (this.exploredCellsGrid[idx] === 1) {
          continue;
        }
        const cellCenterX = (col + 0.5) * cellSize;
        const cellCenterY = (row + 0.5) * cellSize;
        if (
          isPointInVisionCone(
            localPlayer.x,
            localPlayer.y,
            localPlayer.facingAngle,
            cellCenterX,
            cellCenterY,
            this.visionObstacles,
            {
              coneAngleDeg: BALANCE.VISION.CONE_ANGLE_DEG,
              rangePx: BALANCE.VISION.RANGE_PX,
              closeSenseRadiusPx: BALANCE.VISION.CLOSE_SENSE_RADIUS_PX,
              targetRadiusPx: cellSize * 0.35,
            }
          )
        ) {
          this.exploredCellsGrid[idx] = 1;
          this.exploredCellsCount += 1;
        }
      }
    }

    // 2. Carimba o polígono de visão atual na memória de cenário explorado (exploredCanvas 1024x1024)
    const scaleX = FOG_TEX_SIZE / mapWidth;
    const scaleY = FOG_TEX_SIZE / mapHeight;
    const closeRadiusTex = BALANCE.VISION.CLOSE_SENSE_RADIUS_PX * scaleX;

    if (this.exploredCtx && poly.length >= 3) {
      this.exploredCtx.save();
      this.exploredCtx.fillStyle = '#ffffff';
      this.exploredCtx.beginPath();
      this.exploredCtx.moveTo(poly[0].x * scaleX, poly[0].y * scaleY);
      for (let i = 1; i < poly.length; i += 1) {
        this.exploredCtx.lineTo(poly[i].x * scaleX, poly[i].y * scaleY);
      }
      this.exploredCtx.closePath();
      this.exploredCtx.fill();

      this.exploredCtx.beginPath();
      this.exploredCtx.arc(
        localPlayer.x * scaleX,
        localPlayer.y * scaleY,
        closeRadiusTex,
        0,
        Math.PI * 2
      );
      this.exploredCtx.fill();
      this.exploredCtx.restore();
    }

    // 3. Compõe os 3 estados no fogTexture (1024x1024):
    //    - Base: Área nunca explorada (rgba(4, 7, 6, 0.90))
    //    - Recorte parcial (exploredCanvas): Cenário explorado fora da visão atual (~0.52 alpha)
    //    - Recorte total (polígono de visão atual): Área atualmente visível (0.0 alpha)
    if (this.fogTexture && poly.length >= 3) {
      const ctx = this.fogTexture.getContext();
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, FOG_TEX_SIZE, FOG_TEX_SIZE);
      ctx.fillStyle = 'rgba(4, 7, 6, 0.90)';
      ctx.fillRect(0, 0, FOG_TEX_SIZE, FOG_TEX_SIZE);

      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 0.42;
      ctx.drawImage(this.exploredCanvas, 0, 0);

      ctx.globalAlpha = 1;
      const originX = localPlayer.x * scaleX;
      const originY = localPlayer.y * scaleY;
      const range = BALANCE.VISION.RANGE_PX * scaleX;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly[0].x * scaleX, poly[0].y * scaleY);
      for (let i = 1; i < poly.length; i += 1) {
        ctx.lineTo(poly[i].x * scaleX, poly[i].y * scaleY);
      }
      ctx.closePath();
      ctx.clip();
      const light = ctx.createRadialGradient(originX, originY, 0, originX, originY, range);
      light.addColorStop(0, 'rgba(255,255,255,1)');
      light.addColorStop(0.62, 'rgba(255,255,255,0.96)');
      light.addColorStop(1, 'rgba(255,255,255,0.18)');
      ctx.fillStyle = light;
      ctx.fillRect(originX - range, originY - range, range * 2, range * 2);
      ctx.restore();

      const nearby = ctx.createRadialGradient(originX, originY, 0, originX, originY, closeRadiusTex);
      nearby.addColorStop(0, 'rgba(255,255,255,1)');
      nearby.addColorStop(0.56, 'rgba(255,255,255,0.9)');
      nearby.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = nearby;
      ctx.fillRect(originX - closeRadiusTex, originY - closeRadiusTex, closeRadiusTex * 2, closeRadiusTex * 2);
      ctx.restore();
      this.refreshFogTexture();
    }

    // 5. Atualiza visibilidade dos props estáticos:
    //    - Ocultos se a célula nunca foi explorada
    //    - Escurecidos se já explorados mas fora da visão atual
    //    - Iluminados se dentro da visão atual
    for (let i = 0; i < this.propEntries.length; i += 1) {
      const { prop, image } = this.propEntries[i];
      const col = Math.min(
        FOG_GRID_COLS - 1,
        Math.max(0, Math.floor(prop.x / cellSize))
      );
      const row = Math.min(
        FOG_GRID_ROWS - 1,
        Math.max(0, Math.floor(prop.y / cellSize))
      );
      const isCellExplored = this.exploredCellsGrid[row * FOG_GRID_COLS + col] === 1;
      const isCurrentlySeen = isPointInVisionCone(
        localPlayer.x,
        localPlayer.y,
        localPlayer.facingAngle,
        prop.x,
        prop.y,
        this.visionObstacles,
        {
          coneAngleDeg: BALANCE.VISION.CONE_ANGLE_DEG,
          rangePx: BALANCE.VISION.RANGE_PX,
          closeSenseRadiusPx: BALANCE.VISION.CLOSE_SENSE_RADIUS_PX,
          targetRadiusPx: 18,
        }
      );

      if (isCurrentlySeen) {
        image.setVisible(true);
        image.setAlpha(1);
        image.clearTint();
      } else if (isCellExplored) {
        image.setVisible(true);
        image.setAlpha(0.72);
        image.setTint(0x7c8f83);
      } else {
        image.setVisible(false);
      }
    }
  }

  private drawWallSegments(): void {
    if (!this.wallSegmentsGraphics) {
      return;
    }
    this.wallSegmentsGraphics.clear();
    if (this.extraWallSegments.length === 0) {
      return;
    }
    this.wallSegmentsGraphics.lineStyle(8, 0x4b5850, 1);
    for (const seg of this.extraWallSegments) {
      this.wallSegmentsGraphics.beginPath();
      this.wallSegmentsGraphics.moveTo(seg.x1, seg.y1);
      this.wallSegmentsGraphics.lineTo(seg.x2, seg.y2);
      this.wallSegmentsGraphics.strokePath();
    }
  }

  private drawUrbanMap(
    player: { x: number; y: number },
    structures: BuildableStructureSnapshot[]
  ): void {
    this.drawWallSegments();
    const g = this.wallSegmentsGraphics;
    for (const b of this.urbanMap.buildings) {
      const x = b.x - b.halfWidth;
      const y = b.y - b.halfHeight;
      const width = b.halfWidth * 2;
      const height = b.halfHeight * 2;
      g.fillStyle(b.color, 1);
      g.fillRect(x, y, width, height);
      const inside = Math.abs(player.x - b.x) < b.halfWidth && Math.abs(player.y - b.y) < b.halfHeight;
      g.fillStyle(0x282b2e, inside ? 0.13 : 0.82);
      g.fillRect(x, y, width, height);
      g.lineStyle(2, 0x9b998a, inside ? 0.12 : 0.35);
      g.lineBetween(x, b.y, x + width, b.y);
    }
    const house = this.urbanMap.house;
    const home = house && this.urbanMap.buildings.find(b => b.doorId === house.doorId);
    if (house && home && Math.abs(player.x - home.x) < home.halfWidth &&
        Math.abs(player.y - home.y) < home.halfHeight) {
      for (const room of house.rooms) {
        g.fillStyle(room.kind === 'living' ? 0x956d4e : 0xa4a596);
        g.fillRect(room.x - room.width / 2, room.y - room.depth / 2, room.width, room.depth);
      }
      for (const item of house.furniture) {
        g.fillStyle(item.kind === 'cabinet' ? 0x70513b : 0x4c605f);
        g.fillRoundedRect(item.x - item.radius * 0.8, item.y - item.radius / 2,
          item.radius * 1.6, item.radius, 4);
      }
    }
    for (const plant of house?.garden ?? []) {
      g.fillStyle(0x567246);
      g.fillCircle(plant.x, plant.y, 7);
    }

    g.lineStyle(8, 0xaaa18b);
    for (const wall of this.urbanMap.walls) g.lineBetween(wall.x1, wall.y1, wall.x2, wall.y2);
    g.lineStyle(5, 0x73a8b3);
    for (const window of this.urbanMap.windows) g.lineBetween(window.x1, window.y1, window.x2, window.y2);
    for (const door of structures) {
      if (door.kind !== 'map_door' && door.kind !== 'shelter_door') continue;
      g.lineStyle(6, door.hp === 0 ? 0x595753 : door.hp < door.maxHp ? 0xac6946 : 0xc5a16c);
      const left = door.x - door.radius;
      const right = door.open || door.hp === 0 ? left : door.x + door.radius;
      g.lineBetween(left, door.y, right, door.y - (door.hp === 0 ? 10 : door.open ? 35 : 0));
    }
  }

  private showTeamPing(ping: { x: number; y: number; colorIndex: number }): void {
    this.dangerPing = { ...ping, remainingMs: 3200 };
    this.levelUpBannerEl.textContent = `PERIGO SINALIZADO · JOGADOR ${ping.colorIndex + 1}`;
    this.levelUpBannerEl.style.display = 'block';
    this.levelUpBannerTimerMs = 2000;
  }

  private triggerDangerPing(): void {
    if (performance.now() < this.nextDangerPingAt) return;
    const state = this.readRenderState();
    const localPlayer = state.players.find((p) => p.id === state.localPlayerId);
    if (!localPlayer || !localPlayer.alive) {
      return;
    }
    this.nextDangerPingAt = performance.now() + 1500;
    if (this.provider instanceof OnlineProvider) this.provider.sendDangerPing();
    const pingDist = 180;
    const px = Math.max(
      24,
      Math.min(
        state.mapWidth - 24,
        localPlayer.x + Math.cos(localPlayer.facingAngle) * pingDist
      )
    );
    const py = Math.max(
      24,
      Math.min(
        state.mapHeight - 24,
        localPlayer.y + Math.sin(localPlayer.facingAngle) * pingDist
      )
    );
    this.dangerPing = {
      x: px,
      y: py,
      remainingMs: 3200,
    };
    this.levelUpBannerEl.textContent = `PERIGO SINALIZADO EM (${Math.round(px)}, ${Math.round(py)})!`;
    this.levelUpBannerEl.style.display = 'block';
    this.levelUpBannerTimerMs = 2000;
  }

  private updateDangerPing(deltaMs: number): void {
    this.dangerPingGraphics.clear();
    if (!this.dangerPing) {
      return;
    }
    this.dangerPing.remainingMs = Math.max(0, this.dangerPing.remainingMs - deltaMs);
    if (this.dangerPing.remainingMs <= 0) {
      this.dangerPing = null;
      return;
    }
    const pulse = 1 + 0.25 * Math.sin(this.dangerPing.remainingMs * 0.015);
    this.dangerPingGraphics.lineStyle(2.5, 0xff5252, 0.92);
    this.dangerPingGraphics.strokeCircle(
      this.dangerPing.x,
      this.dangerPing.y,
      16 * pulse
    );
    this.dangerPingGraphics.fillStyle(0xff5252, 0.85);
    this.dangerPingGraphics.fillCircle(this.dangerPing.x, this.dangerPing.y, 4);
  }

  private processTransientEvents(state = this.readRenderState()): void {
    const events = this.provider.consumeNewEvents();
    if (events.length) this.world3D?.consumeCharacterEvents(events, state);
    const localPlayer = state.players.find((p) => p.id === state.localPlayerId);

    for (const ev of events) {
      if (!this.lobbyOverlay.isVisible() && !this.offlinePaused) this.audio.event(ev);
      if (ev.type === 'fire') {
        const originVisible = this.isWorldPointVisibleToLocalPlayer(
          ev.fromX,
          ev.fromY,
          8,
          localPlayer
        );
        this.combatEffects.onWeaponFire(ev, originVisible);
      } else if (ev.type === 'hit') {
        const hitVisible = this.isWorldPointVisibleToLocalPlayer(ev.x, ev.y, 16, localPlayer);
        this.combatEffects.onProjectileHit(ev, hitVisible);
        if (!ev.killed && hitVisible) {
          this.zombieFlashTimers.set(ev.zombieId, 65);
        }
      } else if (ev.type === 'player_hit') {
        if (ev.playerId === this.provider.localPlayerId) {
          this.cameras.main.shake(110, 0.005);
        }
      } else if (ev.type === 'level_up') {
        this.showLevelUpBanner(
          ev.newLevel,
          ev.bonusLabel,
          ev.weaponDamage,
          ev.weaponFireRate
        );
        if (localPlayer) {
          this.combatEffects.onLevelUpEffect(localPlayer.x, localPlayer.y);
        }
      } else if (ev.type === 'upgrade_chosen') {
        if (ev.playerId === this.provider.localPlayerId) {
          this.levelUpBannerEl.textContent = `UPGRADE ATIVADO: ${ev.upgradeName}`;
          this.levelUpBannerEl.style.display = 'block';
          this.levelUpBannerTimerMs = 2400;
        }
      } else if (ev.type === 'player_revived') {
        this.combatEffects.onLevelUpEffect(ev.x, ev.y);
        this.levelUpBannerEl.textContent = `ALIADO REVIVIDO! (+${ev.hpRestored} HP · 1,6s INVULNERÁVEL)`;
        this.levelUpBannerEl.style.display = 'block';
        this.levelUpBannerTimerMs = 2800;
      } else if (ev.type === 'round_started') {
        if (ev.roundNumber > 1 || ev.isSpecialEliteRound) {
          this.levelUpBannerEl.textContent = ev.isSpecialEliteRound
            ? `RODADA ESPECIAL ${ev.roundNumber}! INIMIGO DE ELITE DETECTADO (${ev.totalZombies} ZUMBIS)`
            : `RODADA ${ev.roundNumber} INICIADA! (${ev.totalZombies} ZUMBIS)`;
          this.levelUpBannerEl.style.display = 'block';
          this.levelUpBannerTimerMs = 2600;
        }
      } else if (ev.type === 'round_completed') {
        const secs = Math.round(ev.intermissionMs / 1000);
        this.levelUpBannerEl.textContent = `RODADA ${ev.roundNumber} CONCLUÍDA! ${secs}s DE PREPARAÇÃO`;
        this.levelUpBannerEl.style.display = 'block';
        this.levelUpBannerTimerMs = 2800;
      } else if (ev.type === 'horde_warning') {
        const secs = Math.round(ev.warningMs / 1000);
        this.levelUpBannerEl.textContent = `ALERTA DE HORDA #${ev.hordeNumber}! CHEGADA EM ${secs}s${ev.direction ? ' · ' + ev.direction.toUpperCase() : ''}`;
        this.levelUpBannerEl.style.display = 'block';
        this.levelUpBannerTimerMs = 3400;
      } else if (ev.type === 'horde_cleared') {
        const seconds = Math.ceil(ev.recoveryMs / 1000);
        this.levelUpBannerEl.textContent = `HORDA VENCIDA · ${seconds}s PARA RECUPERAR E RECONSTRUIR`;
        this.levelUpBannerEl.style.display = 'block';
        this.levelUpBannerTimerMs = 3400;
      } else if (ev.type === 'horde_started') {
        this.levelUpBannerEl.textContent = `HORDA #${ev.hordeNumber} EM CURSO! (${ev.totalZombies} INIMIGOS)`;
        this.levelUpBannerEl.style.display = 'block';
        this.levelUpBannerTimerMs = 3000;
      } else if (ev.type === 'melee_swing') {
        const originVisible = this.isWorldPointVisibleToLocalPlayer(ev.x, ev.y, 12, localPlayer);
        this.combatEffects.onMeleeSwing(ev, originVisible);
      } else if (ev.type === 'weapon_noise') {
        const originVisible = this.isWorldPointVisibleToLocalPlayer(ev.x, ev.y, 12, localPlayer);
        this.combatEffects.onWeaponNoise(ev, originVisible);
      } else if (ev.type === 'loot_picked') {
        if (ev.playerId === this.provider.localPlayerId) {
          this.levelUpBannerEl.textContent = `COLETADO: ${ev.label.toUpperCase()}`;
          this.levelUpBannerEl.style.display = 'block';
          this.levelUpBannerTimerMs = 1900;
        }
      } else if (ev.type === 'structure_built') {
        if (ev.playerId === this.provider.localPlayerId) {
          this.levelUpBannerEl.textContent = `CONSTRUÍDO: ${ev.label.toUpperCase()}`;
          this.levelUpBannerEl.style.display = 'block';
          this.levelUpBannerTimerMs = 1900;
        }
      } else if (ev.type === 'structure_repaired') {
        if (ev.playerId === this.provider.localPlayerId) {
          this.levelUpBannerEl.textContent = `ESTRUTURA REPARADA (+${ev.hpRestored} HP)`;
          this.levelUpBannerEl.style.display = 'block';
          this.levelUpBannerTimerMs = 1900;
        }
      } else if (ev.type === 'structure_damaged') {
        if (ev.destroyed) {
          this.levelUpBannerEl.textContent = `FORTIFICAÇÃO DESTRUÍDA!`;
          this.levelUpBannerEl.style.display = 'block';
          this.levelUpBannerTimerMs = 2000;
        }
      } else if (ev.type === 'player_healed') {
        this.combatEffects.onLevelUpEffect(ev.x, ev.y);
        if (ev.playerId === this.provider.localPlayerId) {
          this.levelUpBannerEl.textContent = `KIT MÉDICO USADO (+${ev.hpRestored} HP)`;
          this.levelUpBannerEl.style.display = 'block';
          this.levelUpBannerTimerMs = 2000;
        }

      }
    }
  }

  private showLevelUpBanner(
    newLevel: number,
    bonusLabel: string,
    weaponDamage: number,
    weaponFireRate: number
  ): void {
    this.levelUpBannerEl.textContent = `NÍVEL ${newLevel} ALCANÇADO!  ·  Bônus Automático: ${bonusLabel} (Dano ${weaponDamage.toFixed(1)} · Cadência ${weaponFireRate.toFixed(2)}/s)`;
    this.levelUpBannerEl.style.display = 'block';
    this.levelUpBannerTimerMs = 3200;
  }

  private updateLevelUpBanner(deltaMs: number): void {
    if (this.upgradePicker.isVisible()) {
      this.levelUpBannerEl.style.display = 'none';
      return;
    }
    if (this.levelUpBannerTimerMs <= 0) {
      return;
    }
    this.levelUpBannerTimerMs = Math.max(0, this.levelUpBannerTimerMs - deltaMs);
    if (this.levelUpBannerTimerMs <= 0) {
      this.levelUpBannerEl.style.display = 'none';
    }
  }

  private handleRestartMatch(): void {
    this.resetWorldEntities();
    this.provider.restart();
    const state = this.readRenderState();
    this.renderPropsForSeed(state.seed, state.props);
    this.syncWorldRender(0);
    document.body.dataset.state = 'playing';
  }

  private readCombinedInput(): Vec2 {
    const kb = this.keyboard.getVector();
    const joy = this.joystick.getVector();
    const input = joy.x !== 0 || joy.y !== 0 ? joy : kb;
    return this.isometricProjection?.inputToGround(input) ?? normalizeInputVector(input.x, input.y);
  }

  private refreshFogTexture(): void {
    if (this.world3D?.available) this.world3D.markFogDirty();
    else this.fogTexture.refresh();
  }

  private readonly onZoomWheel = (event: WheelEvent): void => {
    if (!event.deltaY || !this.world3D?.available || this.lobbyOverlay.isVisible() ||
        this.offlinePaused || this.endGameModal.isVisible() || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    this.adjustZoom(event.deltaY < 0 ? 1 : -1);
  };

  private adjustZoom(direction?: -1 | 1): void {
    this.isometricView.changeZoom(direction);
    this.zoomButton.textContent = `Zoom ${Math.round(this.isometricView.zoom * 100)}%`;
    this.syncWorldRender(0);
  }

  private readRenderState(): RenderWorldState {
    return this.profiler
      ? this.profiler.measure('snapshot', () => this.provider.getRenderState())
      : this.provider.getRenderState();
  }

  private syncWorldRender(deltaMs: number, state = this.readRenderState(), cameraDeltaMs = deltaMs): void {
    this.renderPropsForSeed(state.seed, state.props);

    // Sincroniza visibilidade do Lobby quando estiver no modo online (lobby ou countdown)
    if (this.provider.mode === 'online') {
      if (state.phase === 'lobby' || state.phase === 'countdown') {
        this.lobbyOverlay.showRoomLobby(
          state.roomCode,
          state.phase,
          state.countdownMs,
          state.players,
          state.localPlayerId,
          state.gameMode,
          state.seed
        );
      } else if (this.lobbyOverlay.isVisible()) {
        this.lobbyOverlay.hide();
        document.body.dataset.state = state.gameOver ? 'gameover' : 'playing';
      }
    }

    const showInGameHudBtn =
      !this.lobbyOverlay.isVisible() && !this.endGameModal.isVisible();
    const showPause = this.canPauseOffline();
    this.pauseButton.style.display = showPause ? 'block' : 'none';
    this.hudStatusTextEl.style.paddingRight = showPause ? '76px' : '';
    this.hudMetricsTextEl.style.paddingRight = showPause ? '76px' : '';
    this.hudStack.hidden = !showInGameHudBtn;
    if (!showInGameHudBtn) this.utilityPanel.open = false;
    this.hudTopPanelEl.style.display = showInGameHudBtn ? 'flex' : 'none';
    this.hudWeaponBarEl.style.display = showInGameHudBtn ? 'flex' : 'none';
    this.hudSurvivalBarEl.style.display = showInGameHudBtn ? 'flex' : 'none';
    if (!showInGameHudBtn && !this.inventoryPanel.hidden) {
      this.inventoryPanel.hidden = true;
      this.hudSurvivalBarEl.querySelector('[aria-controls=survival-inventory]')?.setAttribute('aria-expanded', 'false');
    }
    this.hudHintBarEl.style.display = showInGameHudBtn ? 'block' : 'none';
    const showTouchControls = showInGameHudBtn && this.touchControls.matches;
    const quickItemsTarget = this.touchControls.matches
      ? this.quickItems : this.hudSurvivalBarEl.querySelector('.desktop-quick-heal');
    if (quickItemsTarget && this.hudMedkitBtn.parentElement !== quickItemsTarget) {
      quickItemsTarget.appendChild(this.hudMedkitBtn);
      for (const button of [this.hudReloadBtn, this.hudInteractBtn, this.hudRepairBtn]) {
        (this.touchControls.matches ? this.quickItems : document.body).appendChild(button);
      }
    }
    this.quickItems.hidden = !showTouchControls;
    this.graphicsButton.hidden = !showInGameHudBtn;
    this.teamStatus.hidden = !showInGameHudBtn || this.provider.mode !== 'online';
    if (!this.teamStatus.hidden) {
      const status = state.players.filter((p) => p.id !== state.localPlayerId).map((p) =>
        `J${p.colorIndex + 1} ${!p.connected ? 'offline' : !p.alive ? 'caído' : Math.ceil(p.hp) + ' HP'}`
      ).join(' · ');
      if (this.teamStatus.textContent !== status) this.teamStatus.textContent = status;
    }
    this.joystickLayerEl.style.display = showTouchControls ? 'block' : 'none';
    this.hudAimModeBtn.style.display = showTouchControls ? 'block' : 'none';
    this.hudAttackBtn.style.display = showTouchControls ? 'flex' : 'none';
    this.hudPingDangerBtn.style.display = showTouchControls && this.provider.mode === 'online' ? 'block' : 'none';
    this.updateSkipIntermissionButton(state, showInGameHudBtn);

    this.reviveGraphics.clear();
    this.lootGraphics.clear();

    this.visionObstacles = buildObstaclesFromProps(
      state.props,
      [...this.extraWallSegments, ...this.urbanMap.walls, ...this.urbanMap.windows],
      this.urbanMap.house?.furniture,
      state.lootContainers ?? [],
      state.structures ?? []
    );

    const localPlayer = state.players.find((p) => p.id === state.localPlayerId);
    if (localPlayer) {
      this.drawUrbanMap(localPlayer, state.structures ?? []);
      if (this.profiler) {
        this.profiler.measure('fog', () => this.updateVisionAndFogOfWar(localPlayer, state.mapWidth, state.mapHeight));
      } else {
        this.updateVisionAndFogOfWar(localPlayer, state.mapWidth, state.mapHeight);
      }
      this.drawWorldLootAndContainers(
        localPlayer,
        state.lootItems ?? [],
        state.lootContainers ?? [],
        state.structures ?? [],
        showInGameHudBtn
      );
    }

    const invTexScale = 1 / TEXTURE_SCALE;

    // 1. Atualiza jogadores (Jogador 1 Azul colorIndex 0, Jogador 2 Laranja colorIndex 1)
    const activePlayerIds = new Set<string>();
    for (const p of state.players) {
      activePlayerIds.add(p.id);

      let sprite = this.playerSprites.get(p.id);
      let ring = this.playerRings.get(p.id);

      if (!sprite || !ring) {
        const texKey =
          p.colorIndex % 2 === 0 ? TEXTURE_KEYS.PLAYER_BLUE : TEXTURE_KEYS.PLAYER_ORANGE;
        const ringColor = BALANCE.NETWORK.PLAYER_COLORS[p.colorIndex] ?? 0x2b95ff;

        ring = this.add.circle(p.x, p.y, p.radius, ringColor, 0.16);
        ring.setStrokeStyle(1.5, ringColor, 0.7);
        ring.setDepth(9);

        sprite = this.add.image(p.x, p.y, texKey);
        sprite.setScale(invTexScale);
        sprite.setDepth(10);

        this.playerRings.set(p.id, ring);
        this.playerSprites.set(p.id, sprite);
      }

      ring.setPosition(p.x, p.y);
      sprite.setPosition(p.x, p.y);
      sprite.setScale(invTexScale);
      sprite.setRotation(p.facingAngle);

      const baseRingColor = BALANCE.NETWORK.PLAYER_COLORS[p.colorIndex] ?? 0x2b95ff;

      // Feedback visual de morte (e círculo de resgate na Fase 2), desconexão (20s) ou janela de invulnerabilidade
      if (!p.alive) {
        sprite.setAlpha(0.35);
        sprite.setTint(0x777777);
        ring.setStrokeStyle(1.5, 0xd94848, 0.55);

        // Desenha zona de resgate cooperativo (64 px) e arco de progresso se a partida ainda estiver ativa
        if (p.connected && !state.gameOver && state.players.length >= 2) {
          const revRadius = BALANCE.REVIVE.RADIUS_PX;
          const progress = Math.max(0, Math.min(1, p.reviveProgress ?? 0));
          this.reviveGraphics.fillStyle(0x281410, 0.22);
          this.reviveGraphics.fillCircle(p.x, p.y, revRadius);
          this.reviveGraphics.lineStyle(1.5, 0xffaa3b, 0.55);
          this.reviveGraphics.strokeCircle(p.x, p.y, revRadius);

          if (progress > 0) {
            this.reviveGraphics.lineStyle(4, 0x58e88a, 0.95);
            this.reviveGraphics.beginPath();
            this.reviveGraphics.arc(
              p.x,
              p.y,
              p.radius + 10,
              -Math.PI / 2,
              -Math.PI / 2 + Math.PI * 2 * progress,
              false
            );
            this.reviveGraphics.strokePath();
          }
        }
      } else if (!p.connected) {
        sprite.setAlpha(0.55);
        sprite.setTint(0x88ccff);
        ring.setStrokeStyle(2, 0xffe066, 0.85);
      } else if (p.invulnMs > 0) {
        const blink = Math.floor(p.invulnMs / 60) % 2 === 0;
        sprite.setAlpha(blink ? 0.45 : 1);
        sprite.setTint(blink ? 0xffaaaa : 0xffffff);
        ring.setStrokeStyle(1.5, baseRingColor, 0.7);
      } else {
        sprite.setAlpha(1);
        sprite.clearTint();
        ring.setStrokeStyle(1.5, baseRingColor, 0.7);
      }

      if (p.id === state.localPlayerId) {
        this.updateHud(state, p.hp, p.maxHp);
        this.updateWeaponHudBar(p, showInGameHudBtn);
        this.updateSurvivalHudBar(p, state.players, state.structures ?? [], showInGameHudBtn, state.gameMode);
        if (showInGameHudBtn) {
          this.upgradePicker.update(
            p.pendingUpgradeOptions,
            p.pendingUpgradeTimerMs ?? 0
          );
        } else {
          this.upgradePicker.update([], 0);
        }

        const rx = Math.round(p.x);
        const ry = Math.round(p.y);
        const facingDeg = Math.round((p.facingAngle * 180) / Math.PI);
        const activeMag =
          p.activeSlot === 'slot1'
            ? (p.slot1MagAmmo ?? 0)
            : p.activeSlot === 'slot2'
              ? (p.slot2MagAmmo ?? 0)
              : -1;
        document.body.dataset.gameMode = state.gameMode;
        document.body.dataset.seed = String(state.seed);
        document.body.dataset.playerX = String(rx);
        document.body.dataset.playerY = String(ry);
        document.body.dataset.playerFacingDeg = String(facingDeg);
        document.body.dataset.playerHp = String(Math.round(p.hp));
        document.body.dataset.playerMaxHp = String(Math.round(p.maxHp));
        document.body.dataset.equippedWeapon = p.activeWeaponId ?? 'knife';
        document.body.dataset.activeSlot = p.activeSlot ?? 'knife';
        document.body.dataset.slot1Weapon = p.slot1WeaponId ?? '';
        document.body.dataset.slot2Weapon = p.slot2WeaponId ?? '';
        document.body.dataset.magAmmo = String(activeMag);
        document.body.dataset.ammoLight = String(p.ammoLight ?? 0);
        document.body.dataset.ammoShells = String(p.ammoShells ?? 0);
        document.body.dataset.ammoHeavy = String(p.ammoHeavy ?? 0);
        document.body.dataset.wood = String(p.wood ?? 0);
        document.body.dataset.scrap = String(p.scrap ?? 0);
        document.body.dataset.medkits = String(p.medkits ?? 0);
        document.body.dataset.structuresCount = String((state.structures ?? []).length);
        document.body.dataset.structuresBuilt = String(state.structuresBuilt);
        document.body.dataset.reloading = String((p.reloadRemainingMs ?? 0) > 0);
        document.body.dataset.lootItemsCount = String((state.lootItems ?? []).length);
        document.body.dataset.containersCount = String(
          (state.lootContainers ?? []).length
        );
        document.body.dataset.zombiesAlive = String(state.zombies.length);
        document.body.dataset.exploredCells = String(this.exploredCellsCount);
        document.body.dataset.playersCount = String(state.players.length);
        document.body.dataset.kills = String(state.kills);
        document.body.dataset.totalDamageDealt = String(Math.round(state.totalDamageDealt));
        document.body.dataset.totalRevives = String(state.totalRevives);
        document.body.dataset.level = String(state.level);
        document.body.dataset.xp = String(state.xp);
        document.body.dataset.xpToNextLevel = String(state.xpToNextLevel);
        document.body.dataset.weaponDamage = String(state.weaponDamage);
        document.body.dataset.weaponFireRate = String(state.weaponFireRate);
        document.body.dataset.aimMode = this.localAimMode;
        document.body.dataset.tick = String(state.tick);
        document.body.dataset.seq = String(p.lastProcessedSeq);
        document.body.dataset.roomCode = state.roomCode;
        document.body.dataset.roomPhase = state.phase;
        document.body.dataset.pendingUpgrades = (p.pendingUpgradeOptions ?? []).join(',');
        document.body.dataset.upgradesChosen = String(p.upgradesChosenCount ?? 0);
        document.body.dataset.aliveCount = String(
          state.players.filter((pl) => pl.alive).length
        );

        if (state.roundsState) {
          document.body.dataset.roundNumber = String(state.roundsState.roundNumber);
          document.body.dataset.roundPhase = state.roundsState.roundPhase;
          document.body.dataset.roundRemainingZombies = String(
            state.roundsState.roundRemainingZombies
          );
          document.body.dataset.roundsCompleted = String(
            state.roundsState.roundsCompleted
          );
        }
        if (state.explorationState) {
          document.body.dataset.explorationPhase =
            state.explorationState.explorationPhase;
          document.body.dataset.daysSurvived = String(
            state.explorationState.daysSurvived
          );
          document.body.dataset.hordesCleared = String(
            state.explorationState.hordesCleared
          );
          document.body.dataset.sectorsExplored = String(
            state.explorationState.sectorsExplored
          );
        }
      }
    }

    for (const [id, sprite] of this.playerSprites.entries()) {
      if (!activePlayerIds.has(id)) {
        sprite.destroy();
        this.playerSprites.delete(id);
        this.playerRings.get(id)?.destroy();
        this.playerRings.delete(id);
      }
    }

    // 2. Atualiza zumbis vivos e barras de vida aplicando estritamente o cone de visão (Etapa 2)
    this.zombieHpGraphics.clear();
    const activeZombieIds = new Set<number>();
    let visibleZombiesCount = 0;

    for (const z of state.zombies) {
      activeZombieIds.add(z.id);

      let zSprite = this.zombieSprites.get(z.id);
      if (!zSprite) {
        zSprite = this.add.image(z.x, z.y, this.getZombieTextureKey(z.kind));
        zSprite.setDepth(z.isElite ? 12 : z.kind === 'brute' ? 11 : 9);
        this.zombieSprites.set(z.id, zSprite);
      }

      zSprite.setPosition(z.x, z.y);
      zSprite.setRotation(z.facingAngle);
      const baseZombieScale = z.isElite
        ? BALANCE.ROUNDS.ELITE_RADIUS_PX / BALANCE.ZOMBIES.BRUTE.RADIUS
        : 1;
      zSprite.setScale(baseZombieScale * invTexScale);

      // Regra Etapa 2: Zumbis só aparecem quando estão dentro da visão válida do jogador local
      const isVisible = this.isWorldPointVisibleToLocalPlayer(z.x, z.y, z.radius, localPlayer);
      zSprite.setVisible(isVisible);

      if (!isVisible) {
        // Oculta também barra de vida, aura/contorno e flash de dano
        this.zombieFlashTimers.delete(z.id);
        continue;
      }

      visibleZombiesCount += 1;

      // Flash branco curto ao sofrer dano de projétil
      const flashRemaining = (this.zombieFlashTimers.get(z.id) ?? 0) - deltaMs;
      if (flashRemaining > 0) {
        this.zombieFlashTimers.set(z.id, flashRemaining);
        zSprite.setTintFill(0xffffff);
      } else {
        this.zombieFlashTimers.delete(z.id);
        if (z.isElite) {
          zSprite.setTint(0xffb84d);
        } else {
          const tint = z.kind === 'spitter' ? 0xa6e950 : z.kind === 'caller' ? 0xc48de0 :
            z.kind === 'demolisher' ? 0xe07854 : undefined;
          if (tint !== undefined) zSprite.setTint(tint);
          else zSprite.clearTint();
        }
      }

      // Aura dourada/carmesim para inimigo de Elite (apenas quando visível!)
      if (z.isElite) {
        this.zombieHpGraphics.lineStyle(2.5, 0xffc83b, 0.92);
        this.zombieHpGraphics.strokeCircle(z.x, z.y, z.radius + 5);
      }

      // Desenha barra de HP para zumbis feridos ou Elites (apenas quando visível!)
      if (z.hp < z.maxHp || z.isElite) {
        const barW = z.radius * (z.isElite ? 2.2 : 1.8);
        const barH = z.isElite ? 5 : 4;
        const bx = z.x - barW * 0.5;
        const by = z.y - z.radius - 10;
        const ratio = Math.max(0, Math.min(1, z.hp / z.maxHp));

        this.zombieHpGraphics.fillStyle(0x0b0e0c, 0.85);
        this.zombieHpGraphics.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        this.zombieHpGraphics.fillStyle(z.isElite ? 0xffa826 : 0xe04848, 0.95);
        this.zombieHpGraphics.fillRect(bx, by, barW * ratio, barH);
      }
    }

    document.body.dataset.visibleZombies = String(visibleZombiesCount);

    for (const [id, sprite] of this.zombieSprites.entries()) {
      if (!activeZombieIds.has(id)) {
        sprite.destroy();
        this.zombieSprites.delete(id);
        this.zombieFlashTimers.delete(id);
      }
    }

    // 3. Verifica Fim de Jogo (e oculta modal se outro jogador reiniciou a partida no coop)
    if (state.gameOver && !this.endGameModal.isVisible()) {
      if (this.world3D?.available) {
        this.finalPresentation = state;
        this.finalPresentationMs = 1600;
      }
      this.endGameModal.show({
        gameMode: state.gameMode,
        elapsedMs: state.elapsedMs,
        level: state.level,
        kills: state.kills,
        roundsCompleted: state.roundsState?.roundsCompleted ?? 0,
        totalRevives: state.totalRevives,
        totalDamageDealt: state.totalDamageDealt,
        daysSurvived: state.explorationState?.daysSurvived ?? 1,
        hordesCleared: state.explorationState?.hordesCleared ?? 0,
        sectorsExplored: state.explorationState?.sectorsExplored ?? 1,
        structuresBuilt: state.structuresBuilt,
      });
    } else if (!state.gameOver && this.endGameModal.isVisible()) {
      this.endGameModal.hide();
    }

    if (state.phase === 'playing' && !state.gameOver && showInGameHudBtn && !this.offlinePaused && localPlayer) {
      this.minimap.update(state, this.urbanMap, this.exploredCanvas, localPlayer);
    } else {
      this.minimap.hide();
    }

    const use3D = Boolean(this.world3D?.available);
    this.isometricProjection = use3D ? this.isometricView.update(
      localPlayer ?? { x: state.mapWidth / 2, y: state.mapHeight / 2 },
      this.logicalWidth, this.logicalHeight, cameraDeltaMs,
    ) : undefined;
    this.zoomButton.hidden = !use3D;
    this.fogImage.setVisible(!use3D);
    if (use3D) {
      this.cameras.main.stopFollow();
      this.cameras.main.setScroll(0, 0);
      this.cameraTargetId = null;
    } else if (localPlayer && this.cameraTargetId !== localPlayer.id) {
      const sprite = this.playerSprites.get(localPlayer.id);
      if (sprite) this.cameras.main.startFollow(sprite, true, 1, 1);
      this.cameraTargetId = localPlayer.id;
    }
    this.ground.setVisible(!use3D);
    this.arenaGraphics.setVisible(!use3D);
    this.wallSegmentsGraphics.setVisible(!use3D);
    for (const { image } of this.propEntries) {
      if (use3D) image.setVisible(false);
    }
    for (const player of state.players) {
      this.playerSprites.get(player.id)?.setVisible(!use3D);
    }
    if (use3D) {
      for (const sprite of this.zombieSprites.values()) sprite.setVisible(false);
    }
    document.body.dataset.renderer = use3D ? '3d' : '2d';

    this.presentationDeltaMs = cameraDeltaMs;
    this.pendingPresentation = state;
  }

  private applyGroundProjection(camera: Phaser.Cameras.Scene2D.Camera): void {
    const projection = this.isometricProjection;
    if (!projection) return;
    const viewport = { x: camera.x, y: camera.y, width: camera.width, height: camera.height };
    const origin = projection.worldToScreen({ x: 0, y: 0 }, viewport);
    const east = projection.worldToScreen({ x: 1, y: 0 }, viewport);
    const south = projection.worldToScreen({ x: 0, y: 1 }, viewport);
    camera.scrollX = 0;
    camera.scrollY = 0;
    // Phaser 3.90 renderers consume this matrix, although its declaration omits it.
    const matrix = (camera as Phaser.Cameras.Scene2D.Camera & {
      matrix: Phaser.GameObjects.Components.TransformMatrix;
    }).matrix;
    matrix.setTransform(
      east.x - origin.x, east.y - origin.y, south.x - origin.x, south.y - origin.y, origin.x, origin.y,
    );
  }

  private readonly onVisibilityChange = (): void => {
    this.profiler?.suspend();
    this.world3D?.resetQualitySampling();
  };

  private presentWorld(): void {
    const state = this.pendingPresentation;
    if (!state) return;
    this.pendingPresentation = undefined;

    // Phaser resolves follow, bounds and camera shake during its render pass.
    const camera = this.cameras.main;
    let projection = this.isometricProjection;
    if (!projection) {
      const start = camera.getWorldPoint(camera.x, camera.y);
      const end = camera.getWorldPoint(camera.x + camera.width, camera.y + camera.height);
      projection = new GroundProjection({
        x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y,
      });
    }
    this.projection = projection;
    const rect = this.game.canvas.getBoundingClientRect();
    this.updateOffscreenAllyIndicator(state, projection, rect);

    const renderer = this.world3D;
    const use3D = renderer?.available && rect.width > 0 && rect.height > 0;
    if (use3D) {
      const localPlayer = state.players.find((p) => p.id === state.localPlayerId);
      const render = () => renderer.render(state, projection, rect.width, rect.height, this.presentationDeltaMs,
        (x, y, radius) => this.isWorldPointVisibleToLocalPlayer(x, y, radius, localPlayer));
      if (this.profiler) this.profiler.measure('three', render);
      else render();
    }
    if (this.profiler) {
      const timings = this.profiler.finish();
      if (timings) {
        this.debugOverlay.update(this.game.loop.actualFps, state, timings,
          use3D ? renderer.getCounters() : undefined, rect, this.batterySaver);
      }
    }
  }

  private updateSkipIntermissionButton(
    state: ReturnType<IWorldProvider['getRenderState']>,
    showInGameHud: boolean
  ): void {
    if (
      !showInGameHud ||
      state.gameMode !== 'rounds' ||
      state.roundsState?.roundPhase !== 'intermission'
    ) {
      this.hudSkipIntermissionBtn.style.display = 'none';
      return;
    }

    const livingConnected = state.players.filter((p) => p.alive && p.connected);
    const readyCount = livingConnected.filter((p) => p.readyForNextRound).length;
    const totalLiving = Math.max(1, livingConnected.length);
    const localPlayer = state.players.find((p) => p.id === state.localPlayerId);
    const localReady = Boolean(localPlayer?.readyForNextRound);
    const secs = Math.max(
      1,
      Math.ceil((state.roundsState.intermissionRemainingMs ?? 0) / 1000)
    );
    const nextRound = state.roundsState.roundNumber + 1;

    this.hudSkipIntermissionBtn.style.display = 'block';
    if (totalLiving > 1) {
      this.hudSkipIntermissionBtn.textContent = localReady
        ? `AGUARDANDO ALIADO (${readyCount}/${totalLiving}) · RODADA ${nextRound} EM ${secs}s`
        : `ANTECIPAR RODADA ${nextRound} (${readyCount}/${totalLiving}) · ${secs}s [N]`;
    } else {
      this.hudSkipIntermissionBtn.textContent = `ANTECIPAR RODADA ${nextRound} (${secs}s) [N]`;
    }
  }

  private updateOffscreenAllyIndicator(
    state: RenderWorldState,
    projection: GroundProjection,
    rect: DOMRect
  ): void {
    const localPlayer = state.players.find((p) => p.id === state.localPlayerId);
    const ally = state.players.find(
      (p) => p.id !== state.localPlayerId && p.connected
    );

    if (!localPlayer || !ally) {
      this.allyIndicatorEl.style.display = 'none';
      return;
    }

    const view = { x: 0, y: 0, width: this.logicalWidth, height: this.logicalHeight };
    const screen = projection.worldToScreen(ally, view);
    const margin = 36;
    const isInsideView =
      screen.x >= margin && screen.x <= view.width - margin &&
      screen.y >= margin && screen.y <= view.height - margin;

    if (isInsideView) {
      this.allyIndicatorEl.style.display = 'none';
      return;
    }

    const allyCss = projection.worldToScreen(ally, rect);
    const playerCss = projection.worldToScreen(localPlayer, rect);
    const angle = Math.atan2(allyCss.y - playerCss.y, allyCss.x - playerCss.x);
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const radiusX = Math.max(40, rect.width / 2 - 38);
    const radiusY = Math.max(40, rect.height / 2 - 58);
    const indX = centerX + Math.cos(angle) * radiusX;
    const indY = centerY + Math.sin(angle) * radiusY;
    const isDowned = !ally.alive;
    const allyHex = '#' + (BALANCE.NETWORK.PLAYER_COLORS[ally.colorIndex] ?? 0x2b95ff).toString(16).padStart(6, '0');
    const borderHex = isDowned ? '#ff4c4c' : allyHex;
    const textHex = isDowned ? '#ff7a7a' : allyHex;
    const sizePx = isDowned ? 36 : 30;

    this.allyIndicatorEl.style.display = 'flex';
    this.allyIndicatorEl.style.width = `${sizePx}px`;
    this.allyIndicatorEl.style.height = `${sizePx}px`;
    this.allyIndicatorEl.style.left = `${Math.round(indX)}px`;
    this.allyIndicatorEl.style.top = `${Math.round(indY)}px`;
    this.allyIndicatorEl.style.borderColor = borderHex;
    this.allyIndicatorEl.style.color = textHex;
    this.allyIndicatorEl.textContent = isDowned ? 'SOS' : `J${ally.colorIndex + 1}`;
  }

  private getZombieTextureKey(kind: ZombieKind): string {
    switch (kind) {
      case 'fast':
        return TEXTURE_KEYS.ZOMBIE_FAST;
      case 'demolisher':
      case 'brute':
        return TEXTURE_KEYS.ZOMBIE_BRUTE;
      case 'common':
      default:
        return TEXTURE_KEYS.ZOMBIE_COMMON;
    }
  }

  private updateHud(
    state: ReturnType<IWorldProvider['getRenderState']>,
    hp: number,
    maxHp: number
  ): void {
    const hpRatio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
    const xpRatio = Math.max(0, Math.min(1, state.xp / Math.max(1, state.xpToNextLevel)));
    this.hudHpFillEl.style.width = `${hpRatio * 100}%`;
    this.hudHpFillEl.style.backgroundColor = hpRatio > 0.3 ? '#a8b883' : '#e06454';
    this.hudXpFillEl.style.width = `${xpRatio * 100}%`;
    this.hudStatusTextEl.textContent = `${Math.ceil(hp)}/${maxHp} HP · Nível ${state.level}`;

    if (state.gameMode === 'exploration' && state.explorationState) {
      const exp = state.explorationState;
      let phaseTag = `HORDA EM ${formatSurvivalTime(exp.timeUntilNextHordeMs)}`;
      if (exp.explorationPhase === 'horde_warning') {
        phaseTag = `AVISO HORDA #${exp.hordeNumber} (${Math.ceil(exp.warningRemainingMs / 1000)}s)`;
      } else if (exp.explorationPhase === 'horde_active') {
        phaseTag = `HORDA #${exp.hordeNumber} (${exp.hordeRemainingZombies} REST.)`;
      } else if (exp.explorationPhase === 'recovery') {
        phaseTag = `RECUPERAÇÃO (${Math.ceil(exp.recoveryRemainingMs / 1000)}s)`;
      }

      this.hudMetricsTextEl.textContent = `Dia ${exp.daysSurvived} · ${phaseTag}`;
    } else {
      const rState = state.roundsState;
      const rNum = rState?.roundNumber ?? 1;
      const rRem = rState?.roundRemainingZombies ?? state.zombies.length;
      const rPhase =
        rState?.roundPhase === 'intermission'
          ? `INTERVALO ${Math.ceil((rState.intermissionRemainingMs ?? 0) / 1000)}s`
          : rState?.isSpecialEliteRound
            ? `RODADA ELITE ${rNum} (RESTAM ${rRem})`
            : `RODADA ${rNum} (RESTAM ${rRem})`;

      this.hudMetricsTextEl.textContent = rPhase;
    }

    const manual = this.localAimMode === 'manual';
    if (this.touchControls.matches) {
      this.hudHintBarEl.textContent = manual
        ? 'Esq: mover · Dir: mirar · Segure Atacar e arraste para ajustar a mira'
        : 'Esq: mover · Dir: mirar · Disparo automático';
    } else {
      this.hudHintBarEl.textContent = manual
        ? 'WASD: mover · Mouse: mirar · Clique: atacar · M: automático · Q: sinalizar'
        : 'WASD: mover · Mouse: mirar · M: disparo manual · Q: sinalizar';
    }
  }

  private renderPropsForSeed(
    seed: number,
    props: ReturnType<IWorldProvider['getRenderState']>['props']
  ): void {
    if (this.currentSeedRendered === seed) {
      return;
    }
    this.currentSeedRendered = seed;
    this.propsGroup.clear(true, true);
    this.urbanMap = generateUrbanMap(seed);
    for (const label of this.buildingLabels) label.destroy();
    this.buildingLabels.length = 0;
    for (const b of this.urbanMap.buildings) {
      this.buildingLabels.push(this.add.text(b.x, b.y - b.halfHeight + 20, b.name, {
        fontSize: '13px', color: '#eee4cf', stroke: '#22201c', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(6));
    }
    this.propEntries.length = 0;

    const kindToTexture: Record<PropKind, string> = {
      car: TEXTURE_KEYS.PROP_CAR,
      crate: TEXTURE_KEYS.PROP_CRATE,
      bush: TEXTURE_KEYS.PROP_BUSH,
      rubble: TEXTURE_KEYS.PROP_RUBBLE,
    };

    const invTexScale = 1 / TEXTURE_SCALE;

    for (const prop of props) {
      const key = kindToTexture[prop.kind];
      const img = this.add.image(prop.x, prop.y, key);
      img.setRotation(prop.rotation);
      img.setScale(prop.scale * invTexScale);
      img.setDepth(prop.kind === 'rubble' ? 2 : 4);
      this.propsGroup.add(img);
      this.propEntries.push({ prop, image: img });
    }

    this.visionObstacles = buildObstaclesFromProps(props, [...this.extraWallSegments, ...this.urbanMap.walls, ...this.urbanMap.windows], this.urbanMap.house?.furniture);
  }

  private drawArenaBoundariesAndLandmarks(mapWidth: number, mapHeight: number): void {
    const g = this.add.graphics();
    this.arenaGraphics = g;
    g.setDepth(1);
    g.fillStyle(0x343937, 1);
    for (const row of [0.19, 0.81]) {
      g.fillRect(0, mapHeight * row + 172, mapWidth, 72);
      g.lineStyle(2, 0x777464, 0.7);
      g.lineBetween(0, mapHeight * row + 208, mapWidth, mapHeight * row + 208);
    }
    g.fillRect(mapWidth * 0.355 - 36, 0, 72, mapHeight);
    g.fillRect(mapWidth * 0.645 - 36, 0, 72, mapHeight);

    g.lineStyle(1, 0x2c352f, 0.32);
    const step = 250;
    for (let x = step; x < mapWidth; x += step) {
      g.moveTo(x, 0);
      g.lineTo(x, mapHeight);
    }
    for (let y = step; y < mapHeight; y += step) {
      g.moveTo(0, y);
      g.lineTo(mapWidth, y);
    }
    g.strokePath();

    g.lineStyle(2, 0x3b4d41, 0.55);
    g.strokeCircle(BALANCE.PLAYER.SPAWN_X, BALANCE.PLAYER.SPAWN_Y, 64);
    g.lineStyle(1, 0x3b4d41, 0.35);
    g.strokeCircle(
      BALANCE.PLAYER.SPAWN_X,
      BALANCE.PLAYER.SPAWN_Y,
      BALANCE.MAP.SPAWN_CLEAR_RADIUS
    );

    g.lineStyle(6, 0xb84a39, 0.85);
    g.strokeRect(0, 0, mapWidth, mapHeight);

    const r = BALANCE.PLAYER.RADIUS;
    g.lineStyle(1.5, 0xe08a44, 0.5);
    g.strokeRect(r, r, mapWidth - r * 2, mapHeight - r * 2);
  }

  /**
   * Cria os painéis de HUD em DOM Nativo (100% na resolução física da tela do aparelho,
   * sem depender de texto rasterizado em baixa resolução no canvas).
   */
  private createHudOverlay(): void {
    // 1. Painel Superior de Status (HP, Nível/XP, Barras e Métricas da Rodada/Exploração)
    this.hudTopPanelEl = document.createElement('div');
    this.hudTopPanelEl.setAttribute('data-testid', 'hud-top-panel');
    Object.assign(this.hudTopPanelEl.style, {
      position: 'fixed',
      top: 'calc(10px + var(--safe-top))',
      left: 'calc(10px + var(--safe-left))',
      right: 'calc(10px + var(--safe-right))',
      maxWidth: '560px',
      display: 'none',
      flexDirection: 'column',
      gap: '6px',
      padding: '9px 12px',
      backgroundColor: 'rgba(13, 18, 15, 0.88)',
      border: '1px solid #2e3b33',
      borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.55)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      zIndex: '28',
      pointerEvents: 'none',
      userSelect: 'none',
    });

    this.hudStatusTextEl = document.createElement('div');
    this.hudStatusTextEl.setAttribute('data-testid', 'hud-status-text');
    Object.assign(this.hudStatusTextEl.style, {
      fontSize: 'clamp(11px, 2.8vw, 13px)',
      fontWeight: '800',
      color: '#e6ece8',
      letterSpacing: '0.02em',
      lineHeight: '1.2',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });

    const barsRow = document.createElement('div');
    Object.assign(barsRow.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '10px',
      width: '100%',
    });

    const hpTrack = document.createElement('div');
    Object.assign(hpTrack.style, {
      height: '9px',
      backgroundColor: '#1f2822',
      borderRadius: '4px',
      overflow: 'hidden',
      border: '1px solid rgba(255, 255, 255, 0.06)',
    });
    this.hudHpFillEl = document.createElement('div');
    this.hudHpFillEl.dataset.testid = 'hud-hp-fill';
    Object.assign(this.hudHpFillEl.style, {
      width: '100%',
      height: '100%',
      backgroundColor: '#38b865',
      borderRadius: '3px',
      transition: 'width 80ms linear',
    });
    hpTrack.appendChild(this.hudHpFillEl);

    const xpTrack = document.createElement('div');
    Object.assign(xpTrack.style, {
      height: '9px',
      backgroundColor: '#1f2822',
      borderRadius: '4px',
      overflow: 'hidden',
      border: '1px solid rgba(255, 255, 255, 0.06)',
    });
    this.hudXpFillEl = document.createElement('div');
    this.hudXpFillEl.dataset.testid = 'hud-xp-fill';
    Object.assign(this.hudXpFillEl.style, {
      width: '0%',
      height: '100%',
      backgroundColor: '#3b9eff',
      borderRadius: '3px',
      transition: 'width 80ms linear',
    });
    xpTrack.appendChild(this.hudXpFillEl);

    barsRow.append(hpTrack, xpTrack);

    this.hudMetricsTextEl = document.createElement('div');
    this.hudMetricsTextEl.setAttribute('data-testid', 'hud-metrics-text');
    Object.assign(this.hudMetricsTextEl.style, {
      fontSize: 'clamp(10px, 2.5vw, 11.5px)',
      fontWeight: '600',
      color: '#a5b8ad',
      letterSpacing: '0.02em',
      lineHeight: '1.2',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });

    this.hudTopPanelEl.append(this.hudStatusTextEl, barsRow, this.hudMetricsTextEl);
    document.body.appendChild(this.hudTopPanelEl);

    // 2. Painel de Armas e Munição (Etapa 3: [1] Faca sempre disponível + [2] Slot 1 + [3] Slot 2 + Munição)
    this.hudWeaponBarEl = document.createElement('div');
    this.hudWeaponBarEl.setAttribute('data-testid', 'hud-weapon-bar');
    Object.assign(this.hudWeaponBarEl.style, {
      position: 'fixed',
      top: 'calc(86px + var(--safe-top))',
      left: 'calc(10px + var(--safe-left))',
      right: 'calc(10px + var(--safe-right))',
      maxWidth: '560px',
      display: 'none',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '6px',
      padding: '6px 10px',
      backgroundColor: 'rgba(13, 18, 15, 0.88)',
      border: '1px solid #2e3b33',
      borderRadius: '8px',
      boxShadow: '0 4px 14px rgba(0, 0, 0, 0.5)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      zIndex: '29',
      pointerEvents: 'auto',
      userSelect: 'none',
    });

    const slotsRow = document.createElement('div');
    Object.assign(slotsRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    });

    const makeSlotButton = (slot: EquippedSlotId, testId: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-testid', testId);
      Object.assign(btn.style, {
        padding: '4px 8px',
        minHeight: '28px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 'clamp(10px, 2.5vw, 11.5px)',
        fontWeight: '800',
        borderRadius: '5px',
        cursor: 'pointer',
        border: '1.5px solid #3c4f43',
        backgroundColor: 'rgba(20, 29, 24, 0.92)',
        color: '#b8c9be',
        whiteSpace: 'nowrap',
      });
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        btn.blur();
        this.provider.switchWeaponSlot?.(slot);
        this.syncWorldRender(0);
      });
      return btn;
    };

    this.hudSlotKnifeBtn = makeSlotButton('knife', 'btn-slot-knife');
    this.hudSlot1Btn = makeSlotButton('slot1', 'btn-slot-1');
    this.hudSlot2Btn = makeSlotButton('slot2', 'btn-slot-2');
    slotsRow.append(this.hudSlotKnifeBtn, this.hudSlot1Btn, this.hudSlot2Btn);

    this.hudAmmoStatusEl = document.createElement('div');
    this.hudAmmoStatusEl.setAttribute('data-testid', 'hud-ammo-status');
    Object.assign(this.hudAmmoStatusEl.style, {
      fontSize: 'clamp(10px, 2.5vw, 11.5px)',
      fontWeight: '700',
      color: '#dce8e0',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });

    this.hudWeaponBarEl.append(slotsRow, this.hudAmmoStatusEl);
    document.body.appendChild(this.hudWeaponBarEl);

    // 2b. Painel de Recursos, Fortificação e Suprimento Médico (Etapa 4)
    this.hudSurvivalBarEl = document.createElement('div');
    this.hudSurvivalBarEl.setAttribute('data-testid', 'hud-survival-bar');
    Object.assign(this.hudSurvivalBarEl.style, {
      position: 'fixed',
      top: 'calc(132px + var(--safe-top))',
      left: 'calc(10px + var(--safe-left))',
      right: 'calc(10px + var(--safe-right))',
      maxWidth: '560px',
      display: 'none',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '6px',
      padding: '5px 10px',
      backgroundColor: 'rgba(13, 18, 15, 0.88)',
      border: '1px solid #2e3b33',
      borderRadius: '8px',
      boxShadow: '0 4px 14px rgba(0, 0, 0, 0.5)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      zIndex: '29',
      pointerEvents: 'auto',
      userSelect: 'none',
    });

    this.hudResourcesStatusEl = document.createElement('div');
    this.hudResourcesStatusEl.setAttribute('data-testid', 'hud-resources-status');
    Object.assign(this.hudResourcesStatusEl.style, {
      fontSize: 'clamp(10px, 2.5vw, 11.5px)',
      fontWeight: '800',
      color: '#e8d49c',
      whiteSpace: 'nowrap',
    });

    const makeSurvivalBtn = (
      label: string,
      testId: string,
      onClick: () => void
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-testid', testId);
      btn.textContent = label;
      Object.assign(btn.style, {
        padding: '4px 7px',
        minHeight: '26px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 'clamp(9.5px, 2.3vw, 11px)',
        fontWeight: '800',
        borderRadius: '5px',
        cursor: 'pointer',
        border: '1.5px solid #496353',
        backgroundColor: 'rgba(22, 32, 26, 0.92)',
        color: '#d8e6dc',
        whiteSpace: 'nowrap',
      });
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        btn.blur();
        onClick();
        this.processTransientEvents();
        this.syncWorldRender(0);
      });
      return btn;
    };

    this.hudBuildWoodBtn = makeSurvivalBtn('[B] BARRICADA (2M)', 'btn-build-wood', () =>
      this.provider.buildStructure?.('wood_barricade')
    );
    this.hudBuildTrapBtn = makeSurvivalBtn('[V] ESPINHOS (1M+1S)', 'btn-build-trap', () =>
      this.provider.buildStructure?.('spike_trap')
    );
    this.hudBuildScrapBtn = makeSurvivalBtn('[G] REFORÇADA (2M+2S)', 'btn-build-scrap', () =>
      this.provider.buildStructure?.('scrap_barricade')
    );
    this.hudMedkitBtn = makeSurvivalBtn('[H] CURAR', 'btn-use-medkit', () =>
      this.provider.useMedkit?.()
    );

    this.shelterButtons.clear();
    this.shelterControls = document.createElement('div');
    Object.assign(this.shelterControls.style, { flexWrap: 'wrap', gap: '5px' });
    for (const kind of ['shelter_marker', 'shelter_wall', 'shelter_door', 'slow_trap', 'storage'] as const) {
      const { name, woodCost, scrapCost } = getStructureDefinition(kind);
      const cost = woodCost || scrapCost ? ` (${woodCost}M+${scrapCost}S)` : '';
      const button = makeSurvivalBtn(name + cost, 'build-' + kind, () => this.provider.buildStructure?.(kind));
      this.shelterButtons.set(kind, button);
      this.shelterControls.appendChild(button);
    }
    const inventoryButton = makeSurvivalBtn('INVENTÁRIO', 'btn-inventory', () => {
      this.inventoryPanel.hidden = !this.inventoryPanel.hidden;
      if (!this.inventoryPanel.hidden) {
        construction.open = false;
        this.utilityPanel.open = false;
      }
      inventoryButton.setAttribute('aria-expanded', String(!this.inventoryPanel.hidden));
    });
    inventoryButton.setAttribute('aria-expanded', 'false');
    inventoryButton.setAttribute('aria-controls', 'survival-inventory');
    inventoryButton.style.minHeight = '44px';

    this.inventoryPanel = document.createElement('div');
    this.inventoryPanel.id = 'survival-inventory';
    this.inventoryPanel.hidden = true;
    Object.assign(this.inventoryPanel.style, {
      width: '100%', maxHeight: '36dvh', overflowY: 'auto', overscrollBehavior: 'contain',
      touchAction: 'pan-y',
    });
    this.supplyRows = SUPPLY_SLOTS.map((slot) => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 46px auto auto', gap: '4px',
        alignItems: 'center', minHeight: '45px', color: '#e3f5ea', borderTop: '1px solid #324238',
      });
      const quantity = document.createElement('span');
      const amount = document.createElement('input');
      amount.type = 'number';
      amount.inputMode = 'numeric';
      amount.required = true;
      amount.min = '1';
      amount.step = '1';
      amount.value = '1';
      amount.setAttribute('aria-label', 'Quantidade de ' + slot.label);
      amount.addEventListener('keydown', (event) => event.stopPropagation());
      Object.assign(amount.style, { width: '100%', minHeight: '40px', boxSizing: 'border-box' });
      const drop = makeSurvivalBtn('Soltar', 'drop-' + slot.kind, () => {
        if (amount.checkValidity()) this.provider.moveSupply?.(slot.kind, amount.valueAsNumber, 'drop');
      });
      const share = makeSurvivalBtn('Dar', 'share-' + slot.kind, () => {
        if (amount.checkValidity()) this.provider.moveSupply?.(slot.kind, amount.valueAsNumber, 'share');
      });
      share.setAttribute('aria-label', 'Dar ' + slot.label + ' ao parceiro próximo');
      for (const button of [drop, share]) button.style.minHeight = '44px';
      const deposit = makeSurvivalBtn('Guardar', 'store-' + slot.kind, () => {
        if (amount.checkValidity()) this.provider.moveSupply?.(slot.kind, amount.valueAsNumber, 'deposit');
      });
      const withdraw = makeSurvivalBtn('Retirar', 'withdraw-' + slot.kind, () => {
        if (amount.checkValidity()) this.provider.moveSupply?.(slot.kind, amount.valueAsNumber, 'withdraw');
      });
      const storageActions = document.createElement('div');
      Object.assign(storageActions.style, { gridColumn: '1 / -1', display: 'flex', gap: '4px' });
      storageActions.append(deposit, withdraw);
      row.append(quantity, amount, drop, share, storageActions);
      this.inventoryPanel.appendChild(row);
      return { quantity, amount, drop, share, deposit, withdraw };
    });
    const construction = document.createElement('details');
    construction.className = 'interface-details hud-construction';
    construction.name = 'hud-utility';
    const constructionLabel = document.createElement('summary');
    constructionLabel.textContent = 'Construir';
    const constructionActions = document.createElement('div');
    constructionActions.className = 'construction-actions';
    constructionActions.append(this.hudBuildWoodBtn, this.hudBuildScrapBtn, this.hudBuildTrapBtn, this.shelterControls);
    constructionActions.prepend(this.hudResourcesStatusEl);
    construction.append(constructionLabel, constructionActions);

    this.utilityPanel = document.createElement('details');
    this.utilityPanel.className = 'interface-details hud-settings';
    this.utilityPanel.name = 'hud-utility';
    const settingsLabel = document.createElement('summary');
    settingsLabel.textContent = 'Opções';
    this.utilityPanel.appendChild(settingsLabel);
    for (const details of [construction, this.utilityPanel]) {
      details.addEventListener('toggle', () => {
        if (!details.open) return;
        this.inventoryPanel.hidden = true;
        inventoryButton.setAttribute('aria-expanded', 'false');
      });
    }

    const desktopQuickHeal = document.createElement('div');
    desktopQuickHeal.className = 'desktop-quick-heal';
    desktopQuickHeal.appendChild(this.hudMedkitBtn);
    this.hudSurvivalBarEl.append(inventoryButton, construction, this.utilityPanel, desktopQuickHeal, this.inventoryPanel);

    this.hudStack = document.createElement('div');
    this.hudStack.className = 'hud-stack';
    this.hudStack.hidden = true;
    this.hudStack.append(this.hudTopPanelEl, this.hudWeaponBarEl, this.hudSurvivalBarEl);
    document.body.appendChild(this.hudStack);

    // 3. Barra de Dicas Táticas Inferior em DOM Nativo HiDPI
    this.hudHintBarEl = document.createElement('div');
    this.hudHintBarEl.setAttribute('data-testid', 'hud-hint-bar');
    Object.assign(this.hudHintBarEl.style, {
      position: 'fixed',
      bottom: 'calc(48px + var(--safe-bottom))',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'none',
      padding: '4px 10px',
      maxWidth: '94vw',
      backgroundColor: 'rgba(13, 19, 15, 0.84)',
      border: '1px solid rgba(62, 84, 70, 0.55)',
      borderRadius: '5px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 'clamp(10px, 2.5vw, 11.5px)',
      fontWeight: '600',
      color: '#b0c2b6',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      zIndex: '28',
      pointerEvents: 'none',
      userSelect: 'none',
    });
    document.body.appendChild(this.hudHintBarEl);

    // 4. Indicador de Aliado Fora da Tela (P2 / SOS) em DOM Nativo HiDPI
    this.allyIndicatorEl = document.createElement('div');
    this.allyIndicatorEl.setAttribute('data-testid', 'ally-indicator');
    Object.assign(this.allyIndicatorEl.style, {
      position: 'fixed',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      transform: 'translate(-50%, -50%)',
      backgroundColor: 'rgba(15, 20, 17, 0.94)',
      border: '2px solid #ff7b29',
      borderRadius: '50%',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      fontWeight: '800',
      color: '#ff9d5c',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6)',
      zIndex: '29',
      pointerEvents: 'none',
      userSelect: 'none',
    });
    document.body.appendChild(this.allyIndicatorEl);

    // 5. Camada Visual dos Joysticks Virtuais (Esquerdo: MOVER, Direito: OLHAR / MIRAR) em DOM Nativo HiDPI
    this.joystickLayerEl = document.createElement('div');
    this.joystickLayerEl.setAttribute('data-testid', 'joystick-layer');
    Object.assign(this.joystickLayerEl.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '25',
    });

    this.leftJoyBaseEl = document.createElement('div');
    Object.assign(this.leftJoyBaseEl.style, {
      position: 'fixed',
      transform: 'translate(-50%, -50%)',
      borderRadius: '50%',
      backgroundColor: 'rgba(16, 23, 19, 0.24)',
      border: '2px solid rgba(75, 107, 88, 0.45)',
    });

    this.leftJoyKnobEl = document.createElement('div');
    Object.assign(this.leftJoyKnobEl.style, {
      position: 'fixed',
      transform: 'translate(-50%, -50%)',
      borderRadius: '50%',
      backgroundColor: 'rgba(43, 149, 255, 0.42)',
      border: '1.5px solid rgba(216, 236, 255, 0.55)',
    });

    this.leftJoyLabelEl = document.createElement('div');
    this.leftJoyLabelEl.textContent = 'MOVER';
    Object.assign(this.leftJoyLabelEl.style, {
      position: 'fixed',
      transform: 'translate(-50%, -50%)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      fontWeight: '800',
      letterSpacing: '0.05em',
      color: '#7ab8ff',
      textShadow: '0 1px 3px rgba(0, 0, 0, 0.85)',
      whiteSpace: 'nowrap',
    });

    this.rightJoyBaseEl = document.createElement('div');
    Object.assign(this.rightJoyBaseEl.style, {
      position: 'fixed',
      transform: 'translate(-50%, -50%)',
      borderRadius: '50%',
      backgroundColor: 'rgba(31, 20, 14, 0.28)',
      border: '2px solid rgba(255, 138, 61, 0.50)',
    });

    this.rightJoyKnobEl = document.createElement('div');
    Object.assign(this.rightJoyKnobEl.style, {
      position: 'fixed',
      transform: 'translate(-50%, -50%)',
      borderRadius: '50%',
      backgroundColor: 'rgba(255, 123, 41, 0.46)',
      border: '1.5px solid rgba(255, 228, 204, 0.60)',
    });

    this.rightJoyLabelEl = document.createElement('div');
    this.rightJoyLabelEl.textContent = 'OLHAR / MIRAR';
    Object.assign(this.rightJoyLabelEl.style, {
      position: 'fixed',
      transform: 'translate(-50%, -50%)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      fontWeight: '800',
      letterSpacing: '0.05em',
      color: '#ff9d5c',
      textShadow: '0 1px 3px rgba(0, 0, 0, 0.85)',
      whiteSpace: 'nowrap',
    });

    this.joystickLayerEl.append(
      this.leftJoyBaseEl,
      this.leftJoyKnobEl,
      this.leftJoyLabelEl,
      this.rightJoyBaseEl,
      this.rightJoyKnobEl,
      this.rightJoyLabelEl
    );
    document.body.appendChild(this.joystickLayerEl);
  }

  private createHudDomControls(): void {
    // 1. Botão interativo na HUD para alternar Tiro Automático vs Manual
    this.hudAimModeBtn = document.createElement('button');
    this.hudAimModeBtn.type = 'button';
    this.hudAimModeBtn.setAttribute('data-testid', 'btn-hud-aim-mode');
    Object.assign(this.hudAimModeBtn.style, {
      position: 'fixed',
      bottom: 'calc(10px + var(--safe-bottom))',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '6px 14px',
      minHeight: '34px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      fontWeight: '700',
      borderRadius: '6px',
      cursor: 'pointer',
      zIndex: '30',
      pointerEvents: 'auto',
      whiteSpace: 'nowrap',
      boxShadow: '0 4px 14px rgba(0, 0, 0, 0.5)',
    });
    this.hudAimModeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hudAimModeBtn.blur();
      this.setAimMode(this.localAimMode === 'auto' ? 'manual' : 'auto');
    });
    document.body.appendChild(this.hudAimModeBtn);
    this.refreshHudAimModeButton();

    // 2. Botão dedicado de Ataque (Celular / HUD) para atacar sem precisar gastar munição ao girar a mira
    this.hudAttackBtn = document.createElement('button');
    this.hudAttackBtn.type = 'button';
    this.hudAttackBtn.setAttribute('data-testid', 'btn-attack');
    this.hudAttackBtn.setAttribute('aria-label', 'Executar Ataque');
    this.hudAttackBtn.innerHTML = `<span style="font-size:13px;font-weight:900;letter-spacing:0.5px;">ATACAR</span>`;
    Object.assign(this.hudAttackBtn.style, {
      position: 'fixed',
      bottom: 'calc(clamp(72px, 17dvh, 132px) + var(--safe-bottom))',
      right: 'calc(24px + var(--safe-right))',
      width: '68px',
      height: '68px',
      borderRadius: '50%',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      backgroundColor: 'rgba(180, 52, 34, 0.90)',
      border: '2.5px solid #ff9d5c',
      color: '#fff3e6',
      cursor: 'pointer',
      zIndex: '31',
      pointerEvents: 'auto',
      touchAction: 'none',
      userSelect: 'none',
      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.65)',
    });
    const setAttackActiveVisual = (active: boolean, cancelled = false) => {
      this.joystick.setAttackButtonHeld(active, cancelled);
      this.hudAttackBtn.style.backgroundColor = active
        ? 'rgba(235, 84, 48, 0.98)'
        : 'rgba(180, 52, 34, 0.90)';
      this.hudAttackBtn.style.transform = active ? 'scale(0.94)' : 'scale(1)';
    };
    let firePointer: number | null = null;
    let dragX = 0;
    let dragY = 0;
    this.hudAttackBtn.addEventListener('pointerdown', (ev) => {
      if (firePointer !== null || ev.button !== 0) return;
      ev.stopPropagation();
      ev.preventDefault();
      firePointer = ev.pointerId;
      dragX = ev.clientX;
      dragY = ev.clientY;
      this.hudAttackBtn.setPointerCapture(ev.pointerId);
      setAttackActiveVisual(true);
    });
    this.hudAttackBtn.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== firePointer || this.joystick.getRightAimState().active) return;
      const dx = ev.clientX - dragX;
      const dy = ev.clientY - dragY;
      if (Math.hypot(dx, dy) >= 12) this.joystick.setAimDirection(dx, dy);
    });
    const finishAttack = (ev: PointerEvent) => {
      if (ev.pointerId !== firePointer) return;
      firePointer = null;
      setAttackActiveVisual(false, ev.type !== 'pointerup');
    };
    this.hudAttackBtn.addEventListener('pointerup', finishAttack);
    this.hudAttackBtn.addEventListener('pointercancel', finishAttack);
    this.hudAttackBtn.addEventListener('lostpointercapture', finishAttack);
    document.body.appendChild(this.hudAttackBtn);

    // 3. Botão de Recarregar [R] (exibido quando com arma de fogo equipada)
    this.hudReloadBtn = document.createElement('button');
    this.hudReloadBtn.type = 'button';
    this.hudReloadBtn.setAttribute('data-testid', 'btn-reload');
    this.hudReloadBtn.textContent = 'RECARREGAR [R]';
    Object.assign(this.hudReloadBtn.style, {
      position: 'fixed',
      bottom: 'calc(322px + var(--safe-bottom))',
      right: 'calc(20px + var(--safe-right))',
      display: 'none',
      padding: '7px 11px',
      minHeight: '34px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '10.5px',
      fontWeight: '800',
      backgroundColor: 'rgba(28, 46, 62, 0.92)',
      border: '1.5px solid #58b4ff',
      color: '#c2e4ff',
      borderRadius: '6px',
      cursor: 'pointer',
      zIndex: '31',
      pointerEvents: 'auto',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
    });
    this.hudReloadBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hudReloadBtn.blur();
      this.provider.reloadWeapon?.();
      this.syncWorldRender(0);
    });
    document.body.appendChild(this.hudReloadBtn);

    // 4. Botão Contextual de Interação [E] para abrir caixa/recipiente ou pegar arma no chão
    this.hudInteractBtn = document.createElement('button');
    this.hudInteractBtn.type = 'button';
    this.hudInteractBtn.setAttribute('data-testid', 'btn-interact-loot');
    this.hudInteractBtn.textContent = 'INTERAGIR [E]';
    Object.assign(this.hudInteractBtn.style, {
      position: 'fixed',
      bottom: 'calc(366px + var(--safe-bottom))',
      right: 'calc(20px + var(--safe-right))',
      display: 'none',
      padding: '8px 12px',
      minHeight: '36px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      fontWeight: '800',
      backgroundColor: 'rgba(56, 44, 16, 0.95)',
      border: '1.5px solid #ffc847',
      color: '#ffeaad',
      borderRadius: '6px',
      cursor: 'pointer',
      zIndex: '32',
      pointerEvents: 'auto',
      boxShadow: '0 6px 16px rgba(0, 0, 0, 0.65)',
    });
    this.hudInteractBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hudInteractBtn.blur();
      this.provider.interactLoot?.();
      this.processTransientEvents();
      this.syncWorldRender(0);
    });
    document.body.appendChild(this.hudInteractBtn);

    // 4b. Botão Contextual de Reparo de Estrutura [X] quando próximo a uma fortificação danificada (Etapa 4)
    this.hudRepairBtn = document.createElement('button');
    this.hudRepairBtn.type = 'button';
    this.hudRepairBtn.setAttribute('data-testid', 'btn-repair-structure');
    this.hudRepairBtn.textContent = 'REPARAR [X] (1 MADEIRA)';
    Object.assign(this.hudRepairBtn.style, {
      position: 'fixed',
      bottom: 'calc(410px + var(--safe-bottom))',
      right: 'calc(20px + var(--safe-right))',
      display: 'none',
      padding: '8px 12px',
      minHeight: '36px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      fontWeight: '800',
      backgroundColor: 'rgba(28, 56, 36, 0.95)',
      border: '1.5px solid #63cf88',
      color: '#b8ffd6',
      borderRadius: '6px',
      cursor: 'pointer',
      zIndex: '32',
      pointerEvents: 'auto',
      boxShadow: '0 6px 16px rgba(0, 0, 0, 0.65)',
    });
    this.hudRepairBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hudRepairBtn.blur();
      this.provider.repairStructure?.();
      this.processTransientEvents();
      this.syncWorldRender(0);
    });
    document.body.appendChild(this.hudRepairBtn);

    // 5. Botão de sinalizar perigo para o parceiro (Coop) sem revelar visão através de paredes
    this.hudPingDangerBtn = document.createElement('button');
    this.hudPingDangerBtn.type = 'button';
    this.hudPingDangerBtn.setAttribute('data-testid', 'btn-ping-danger');
    this.hudPingDangerBtn.textContent = 'Alerta';
    Object.assign(this.hudPingDangerBtn.style, {
      position: 'fixed',
      bottom: 'calc(280px + var(--safe-bottom))',
      right: 'calc(20px + var(--safe-right))',
      display: 'none',
      padding: '6px 10px',
      minHeight: '32px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '10px',
      fontWeight: '800',
      backgroundColor: 'rgba(62, 24, 24, 0.90)',
      border: '1.5px solid #ff6b6b',
      color: '#ffb8b8',
      borderRadius: '6px',
      cursor: 'pointer',
      zIndex: '31',
      pointerEvents: 'auto',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
    });
    this.hudPingDangerBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hudPingDangerBtn.blur();
      this.triggerDangerPing();
    });
    document.body.appendChild(this.hudPingDangerBtn);

    // 6. Botão para antecipar a próxima rodada durante o intervalo de 25s no Modo 1
    this.hudSkipIntermissionBtn = document.createElement('button');
    this.hudSkipIntermissionBtn.type = 'button';
    this.hudSkipIntermissionBtn.setAttribute('data-testid', 'btn-skip-intermission');
    Object.assign(this.hudSkipIntermissionBtn.style, {
      position: 'fixed',
      top: 'calc(18px + var(--safe-top))',
      right: 'calc(16px + var(--safe-right))',
      display: 'none',
      padding: '8px 14px',
      minHeight: '36px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '12px',
      fontWeight: '800',
      backgroundColor: 'rgba(24, 58, 36, 0.95)',
      border: '1.5px solid #63cf88',
      color: '#a3ffd0',
      borderRadius: '6px',
      cursor: 'pointer',
      zIndex: '33',
      pointerEvents: 'auto',
      whiteSpace: 'nowrap',
      boxShadow: '0 6px 18px rgba(0, 0, 0, 0.6)',
    });
    this.hudSkipIntermissionBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hudSkipIntermissionBtn.blur();
      this.provider.skipRoundIntermission?.();
      this.processTransientEvents();
      this.syncWorldRender(0);
    });
    document.body.appendChild(this.hudSkipIntermissionBtn);

    // 7. Banner flutuante ao subir de nível ou mudar fase de rodada/horda
    this.levelUpBannerEl = document.createElement('div');
    this.levelUpBannerEl.setAttribute('data-testid', 'level-up-banner');
    Object.assign(this.levelUpBannerEl.style, {
      position: 'fixed',
      top: 'calc(140px + var(--safe-top))',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'none',
      maxWidth: '92vw',
      textAlign: 'center',
      backgroundColor: 'rgba(18, 38, 26, 0.94)',
      border: '1.5px solid #58d682',
      borderRadius: '8px',
      padding: '8px 14px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '12px',
      fontWeight: '800',
      color: '#a3ffd0',
      zIndex: '32',
      pointerEvents: 'none',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
    });
    document.body.appendChild(this.levelUpBannerEl);
  }

  /**
   * Atualiza os 3 slots da barra de armas (`[1] Faca`, `[2] Slot 1`, `[3] Slot 2`),
   * o indicador de munição no carregador/reserva e o botão de recarga (`RECARREGAR [R]`).
   */
  private updateWeaponHudBar(
    p: ReturnType<IWorldProvider['getRenderState']>['players'][number],
    showInGameHud: boolean
  ): void {
    const activeSlot = p.activeSlot ?? 'knife';
    const equippedId = p.activeWeaponId ?? 'knife';
    const equippedSpec = getWeaponDefinition(equippedId);

    const styleSlotBtn = (
      btn: HTMLButtonElement,
      isActive: boolean,
      hasWeapon: boolean
    ) => {
      btn.setAttribute('aria-pressed', String(isActive));
      btn.style.backgroundColor = isActive
        ? 'rgba(34, 68, 48, 0.96)'
        : hasWeapon
          ? 'rgba(22, 32, 26, 0.92)'
          : 'rgba(16, 22, 18, 0.65)';
      btn.style.borderColor = isActive ? '#63cf88' : hasWeapon ? '#496353' : '#2d3b32';
      btn.style.color = isActive ? '#b8ffd6' : hasWeapon ? '#d8e6dc' : '#6d8074';
    };

    const shortWeaponLabel = (wId: WeaponId): string => {
      switch (wId) {
        case 'bat':
          return 'BASTÃO';
        case 'pistol':
          return 'PISTOLA';
        case 'shotgun':
          return 'ESCOPETA';
        case 'smg':
          return 'SMG';
        case 'rifle':
          return 'RIFLE';
        default:
          return 'FACA';
      }
    };

    this.hudSlotKnifeBtn.textContent = '[1] FACA';
    styleSlotBtn(this.hudSlotKnifeBtn, activeSlot === 'knife', true);

    const slot1Spec = p.slot1WeaponId ? getWeaponDefinition(p.slot1WeaponId) : null;
    this.hudSlot1Btn.textContent = slot1Spec
      ? `[2] ${shortWeaponLabel(slot1Spec.id)}`
      : '[2] VAZIO';
    styleSlotBtn(this.hudSlot1Btn, activeSlot === 'slot1', Boolean(slot1Spec));

    const slot2Spec = p.slot2WeaponId ? getWeaponDefinition(p.slot2WeaponId) : null;
    this.hudSlot2Btn.textContent = slot2Spec
      ? `[3] ${shortWeaponLabel(slot2Spec.id)}`
      : '[3] VAZIO';
    styleSlotBtn(this.hudSlot2Btn, activeSlot === 'slot2', Boolean(slot2Spec));

    if (equippedSpec.category === 'melee') {
      this.hudAmmoStatusEl.textContent = 'Corpo a corpo';
      this.hudAmmoStatusEl.style.color = '#9ed5ff';
      this.hudReloadBtn.style.display = 'none';
      return;
    }

    const magAmmo =
      activeSlot === 'slot1'
        ? (p.slot1MagAmmo ?? 0)
        : activeSlot === 'slot2'
          ? (p.slot2MagAmmo ?? 0)
          : 0;
    const ammoType = equippedSpec.ammoType;
    const reserve =
      ammoType === 'light'
        ? (p.ammoLight ?? 0)
        : ammoType === 'shells'
          ? (p.ammoShells ?? 0)
          : (p.ammoHeavy ?? 0);
    const ammoTypeLabel = getAmmoLabel(ammoType);
    const isReloading = (p.reloadRemainingMs ?? 0) > 0;
    const shortEquipped = shortWeaponLabel(equippedSpec.id);

    if (isReloading) {
      const remSec = ((p.reloadRemainingMs ?? 0) / 1000).toFixed(1);
      this.hudAmmoStatusEl.textContent = `RECARREGANDO ${shortEquipped}... (${remSec}s) · ${ammoTypeLabel} [${reserve}]`;
      this.hudAmmoStatusEl.style.color = '#ffd56b';
    } else {
      this.hudAmmoStatusEl.textContent = `${magAmmo}/${equippedSpec.magSize} · ${reserve} reserva`;
      this.hudAmmoStatusEl.style.color =
        magAmmo === 0 ? '#ff7a7a' : '#dce8e0';
    }

    const canReload =
      showInGameHud &&
      !isReloading &&
      magAmmo < equippedSpec.magSize &&
      reserve > 0;
    this.hudReloadBtn.style.display = canReload ? 'block' : 'none';
  }

  /**
   * Atualiza o painel de recursos de sobrevivência (`MADEIRA`, `SUCATA`, `KIT MÉDICO`)
   * e o estado dos botões de fortificação, armadilha, cura e reparo (Etapa 4).
   */
  private updateSurvivalHudBar(
    p: PlayerStateSnapshot,
    players: readonly PlayerStateSnapshot[],
    structures: BuildableStructureSnapshot[],
    showInGameHud: boolean,
    gameMode: GameMode
  ): void {
    const wood = p.wood ?? 0;
    const scrap = p.scrap ?? 0;
    const medkits = p.medkits ?? 0;

    this.hudResourcesStatusEl.textContent = `MADEIRA: ${wood} · SUCATA: ${scrap} · KITS: ${medkits}`;

    const styleActionBtn = (
      btn: HTMLButtonElement,
      enabled: boolean,
      accentHex = '#63cf88'
    ) => {
      btn.style.opacity = enabled ? '1' : '0.45';
      btn.style.borderColor = enabled ? accentHex : '#324238';
      btn.style.color = enabled ? '#e3f5ea' : '#7a8f82';
      btn.style.backgroundColor = enabled
        ? 'rgba(24, 42, 31, 0.94)'
        : 'rgba(16, 22, 18, 0.65)';
    };

    const canWood = p.alive && canAffordStructure(p, 'wood_barricade');
    const canTrap = p.alive && canAffordStructure(p, 'spike_trap');
    const canScrap = p.alive && canAffordStructure(p, 'scrap_barricade');
    const cloth = p.cloth ?? 0;
    const canHeal = p.alive && (medkits > 0 || cloth > 0) && p.hp < p.maxHp;

    const marker = structures.find((s) => s.kind === 'shelter_marker');
    const storage = structures.find((s) => s.kind === 'storage' && s.hp > 0);
    this.shelterControls.style.display = gameMode === 'exploration' ? 'flex' : 'none';
    for (const [kind, button] of this.shelterButtons) {
      button.hidden = kind === 'shelter_marker' ? Boolean(marker) : !marker || (kind === 'storage' && Boolean(storage));
      button.disabled = !p.alive || !canAffordStructure(p, kind);
    }

    if (!this.inventoryPanel.hidden) {
      const nearStorage = Boolean(storage && Math.hypot(storage.x - p.x, storage.y - p.y) <= 88 &&
        hasLineOfSight(p.x, p.y, storage.x, storage.y, this.visionObstacles, true));
      const partner = players.find((other) => other.id !== p.id && other.alive && other.connected);
      const canShare = players.some((other) => other.id !== p.id && other.alive && other.connected &&
        Math.hypot(other.x - p.x, other.y - p.y) <= 96 &&
        hasLineOfSight(p.x, p.y, other.x, other.y, this.visionObstacles, true));
      SUPPLY_SLOTS.forEach((slot, index) => {
        const row = this.supplyRows[index];
        const count = p[slot.field] ?? 0;
        const stored = nearStorage ? storage?.supplies?.[slot.kind] ?? 0 : 0;
        row.quantity.textContent = slot.label + ' ×' + count + (nearStorage ? ' · Caixa: ' + stored : '');
        row.amount.max = String(Math.max(1, count, stored));
        row.amount.disabled = !p.alive || count + stored === 0;
        row.drop.disabled = !p.alive || count === 0;
        row.deposit.hidden = row.withdraw.hidden = !nearStorage;
        row.deposit.disabled = row.drop.disabled;
        row.withdraw.disabled = !p.alive || stored === 0;
        row.share.hidden = !partner;
        row.share.disabled = row.drop.disabled || !canShare;
        row.share.title = canShare ? '' : 'Aproxime-se do parceiro';
        styleActionBtn(row.drop, !row.drop.disabled);
        styleActionBtn(row.share, !row.share.disabled);
      });
    }

    styleActionBtn(this.hudBuildWoodBtn, canWood, '#d49b56');
    styleActionBtn(this.hudBuildTrapBtn, canTrap, '#e07a5f');
    styleActionBtn(this.hudBuildScrapBtn, canScrap, '#7cc0eb');
    const healShortcut = this.touchControls.matches ? '' : '[H] ';
    this.hudMedkitBtn.textContent = healShortcut + (medkits > 0 ? `CURAR (${medkits})` : `PANO (${cloth})`);
    this.hudMedkitBtn.disabled = !canHeal;
    styleActionBtn(this.hudMedkitBtn, canHeal, '#58e88a');

    // Verifica se há fortificação danificada dentro de REPAIR_RADIUS_PX
    let damagedNearby: BuildableStructureSnapshot | null = null;
    let bestDist: number = BALANCE.STRUCTURES.REPAIR_RADIUS_PX;
    if (p.alive) {
      for (const s of structures) {
        if (s.kind !== 'map_door' && s.hp > 0 && s.hp < s.maxHp) {
          const d = Math.hypot(s.x - p.x, s.y - p.y);
          if (d <= bestDist) {
            bestDist = d;
            damagedNearby = s;
          }
        }
      }
    }

    if (
      showInGameHud &&
      damagedNearby &&
      wood >= BALANCE.STRUCTURES.REPAIR_WOOD_COST
    ) {
      const tool = (p.repairTools ?? 0) > 0 &&
        damagedNearby.maxHp - damagedNearby.hp > BALANCE.STRUCTURES.REPAIR_HP_AMOUNT;
      this.hudRepairBtn.textContent = `REPARAR ${damagedNearby.label.toUpperCase()} [X] (1M${tool ? ' + ferramenta' : ''})`;
      this.hudRepairBtn.style.display = 'block';
    } else {
      this.hudRepairBtn.style.display = 'none';
    }
  }

  /**
   * Desenha no mundo os itens de loot no chão (`lootItems`), recipientes pesquisáveis (`lootContainers`)
   * e fortificações/armadilhas construídas (`structures`), respeitando o cone de visão e a névoa de guerra da Etapa 2,
   * e atualiza o botão contextual `INTERAGIR [E]`.
   */
  private drawWorldLootAndContainers(
    localPlayer: ReturnType<IWorldProvider['getRenderState']>['players'][number],
    lootItems: WorldLootItemSnapshot[],
    containers: LootContainerSnapshot[],
    structures: BuildableStructureSnapshot[],
    showInGameHud: boolean
  ): void {
    const cellSize = BALANCE.VISION.FOG_CELL_SIZE_PX;
    let nearestActionLabel: string | null = null;
    let nearestDist = Infinity;

    // 0. Estruturas construídas pela dupla (Barricadas e Armadilhas de Espinhos — Etapa 4)
    for (const s of structures) {
      if (s.kind === 'map_door' || s.kind === 'shelter_door') {
        if (s.hp > 0 && localPlayer.alive && Math.abs(s.x - localPlayer.x) < s.radius &&
            Math.abs(s.y - localPlayer.y) <= 32) {
          nearestDist = -1;
          nearestActionLabel = s.open ? 'FECHAR PORTA [E]' : 'ABRIR PORTA [E]';
        }
        continue;
      }
      const col = Math.min(
        FOG_GRID_COLS - 1,
        Math.max(0, Math.floor(s.x / cellSize))
      );
      const row = Math.min(
        FOG_GRID_ROWS - 1,
        Math.max(0, Math.floor(s.y / cellSize))
      );
      const isCellExplored = this.exploredCellsGrid[row * FOG_GRID_COLS + col] === 1;
      const isCurrentlySeen = this.isWorldPointVisibleToLocalPlayer(
        s.x,
        s.y,
        s.radius,
        localPlayer
      );

      if (!isCurrentlySeen && !isCellExplored) {
        continue;
      }

      const alpha = isCurrentlySeen ? 0.96 : 0.48;
      if (s.kind === 'shelter_wall') {
        if (this.world3D?.available) continue;
        const dx = Math.sin(s.rotation) * s.radius;
        const dy = Math.cos(s.rotation) * s.radius;
        this.lootGraphics.lineStyle(9, 0x986947, alpha);
        this.lootGraphics.lineBetween(s.x - dx, s.y - dy, s.x + dx, s.y + dy);
      } else if (s.kind === 'storage') {
        this.lootGraphics.fillStyle(0xb8874d, alpha);
        this.lootGraphics.fillRoundedRect(s.x - 16, s.y - 13, 32, 26, 4);
        this.lootGraphics.lineStyle(3, 0x503e31, alpha);
        this.lootGraphics.lineBetween(s.x - 16, s.y - 2, s.x + 16, s.y - 2);
      } else if (s.kind === 'shelter_marker' || s.kind === 'slow_trap') {
        this.lootGraphics.fillStyle(s.kind === 'shelter_marker' ? 0x75c380 : 0x6595bc, alpha);
        this.lootGraphics.fillCircle(s.x, s.y, s.radius);
      } else if (s.kind === 'wood_barricade') {
        this.lootGraphics.fillStyle(0x6e4720, alpha);
        this.lootGraphics.fillCircle(s.x, s.y, s.radius);
        this.lootGraphics.lineStyle(2.5, 0xd49b56, alpha);
        this.lootGraphics.strokeCircle(s.x, s.y, s.radius);
        // Tábuas cruzadas da barricada
        this.lootGraphics.lineStyle(3, 0xb87d3b, alpha);
        this.lootGraphics.beginPath();
        this.lootGraphics.moveTo(s.x - 12, s.y - 8);
        this.lootGraphics.lineTo(s.x + 12, s.y + 8);
        this.lootGraphics.moveTo(s.x - 12, s.y + 8);
        this.lootGraphics.lineTo(s.x + 12, s.y - 8);
        this.lootGraphics.strokePath();
      } else if (s.kind === 'scrap_barricade') {
        this.lootGraphics.fillStyle(0x374752, alpha);
        this.lootGraphics.fillCircle(s.x, s.y, s.radius);
        this.lootGraphics.lineStyle(2.8, 0x8ab4d4, alpha);
        this.lootGraphics.strokeCircle(s.x, s.y, s.radius);
        this.lootGraphics.lineStyle(2, 0xc2d8e8, alpha);
        this.lootGraphics.strokeCircle(s.x, s.y, s.radius * 0.58);
      } else {
        // Armadilha de Espinhos ('spike_trap')
        this.lootGraphics.fillStyle(0x2b211b, alpha * 0.85);
        this.lootGraphics.fillCircle(s.x, s.y, s.radius);
        this.lootGraphics.lineStyle(1.8, 0xe0684b, alpha);
        this.lootGraphics.strokeCircle(s.x, s.y, s.radius);
        // Pontas metálicas dos espinhos
        this.lootGraphics.fillStyle(0xd9e2ec, alpha);
        for (const [ox, oy] of [
          [0, 0],
          [-9, -7],
          [9, -7],
          [-9, 7],
          [9, 7],
        ]) {
          this.lootGraphics.fillCircle(s.x + ox, s.y + oy, 2.5);
        }
      }

      if (s.hp < s.maxHp && isCurrentlySeen) {
        const barW = s.radius * 1.9;
        const barH = 4;
        const bx = s.x - barW * 0.5;
        const by = s.y - s.radius - 9;
        const ratio = Math.max(0, Math.min(1, s.hp / s.maxHp));
        this.lootGraphics.fillStyle(0x0b0e0c, 0.88);
        this.lootGraphics.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        this.lootGraphics.fillStyle(
          ratio > 0.45 ? 0x58d682 : 0xff9138,
          0.95
        );
        this.lootGraphics.fillRect(bx, by, barW * ratio, barH);
      }
    }

    // 1. Recipientes pesquisáveis (maletas de armas, caixas de suprimentos, caixas de munição)
    for (const c of containers) {
      const col = Math.min(
        FOG_GRID_COLS - 1,
        Math.max(0, Math.floor(c.x / cellSize))
      );
      const row = Math.min(
        FOG_GRID_ROWS - 1,
        Math.max(0, Math.floor(c.y / cellSize))
      );
      const isCellExplored = this.exploredCellsGrid[row * FOG_GRID_COLS + col] === 1;
      const isCurrentlySeen = this.isWorldPointVisibleToLocalPlayer(
        c.x,
        c.y,
        22,
        localPlayer
      );

      if (!isCurrentlySeen && !isCellExplored) {
        continue;
      }

      const alpha = isCurrentlySeen ? 0.95 : 0.45;
      if (!this.world3D?.available || c.label !== 'Casa') drawLootContainer(this.lootGraphics, c, alpha);

      if (!c.opened && localPlayer.alive) {
        const d = Math.hypot(c.x - localPlayer.x, c.y - localPlayer.y);
        if (d <= BALANCE.LOOT.CONTAINER_INTERACT_RADIUS_PX && d < nearestDist) {
          nearestDist = d;
          nearestActionLabel = `ABRIR ${c.label.toUpperCase()} [E]`;
        }
      }
    }

    // 2. Itens de loot no chão (armas e pacotes de munição)
    for (const item of lootItems) {
      const isCurrentlySeen = this.isWorldPointVisibleToLocalPlayer(
        item.x,
        item.y,
        14,
        localPlayer
      );
      if (!isCurrentlySeen) {
        continue;
      }

      drawLootItem(this.lootGraphics, item);

      if (localPlayer.alive) {
        const d = Math.hypot(item.x - localPlayer.x, item.y - localPlayer.y);
        if (d <= BALANCE.LOOT.PICKUP_RADIUS_PX && d < nearestDist) {
          nearestDist = d;
          nearestActionLabel = `PEGAR ${item.label.toUpperCase()} [E]`;
        }
      }
    }

    if (showInGameHud && nearestActionLabel) {
      this.hudInteractBtn.textContent = nearestActionLabel;
      this.hudInteractBtn.style.display = 'block';
    } else {
      this.hudInteractBtn.style.display = 'none';
    }
  }

  private refreshHudAimModeButton(): void {
    if (!this.hudAimModeBtn) {
      return;
    }
    const isAuto = this.localAimMode === 'auto';
    this.hudAimModeBtn.textContent = isAuto ? 'Mira: automática' : 'Mira: manual';
    Object.assign(this.hudAimModeBtn.style, {
      backgroundColor: isAuto ? 'rgba(24, 52, 35, 0.92)' : 'rgba(64, 34, 16, 0.92)',
      border: isAuto ? '1px solid #52c478' : '1px solid #ff9138',
      color: isAuto ? '#8cf5ad' : '#ffc288',
    });
  }

  private drawJoystickOverlay(): void {
    if (!this.touchControls.matches || this.endGameModal.isVisible() || this.lobbyOverlay.isVisible()) {
      this.joystickLayerEl.style.display = 'none';
      return;
    }

    this.joystickLayerEl.style.display = 'block';
    const leftJoy = this.joystick.getVisualState();
    const rightJoy = this.joystick.getRightVisualState();

    const winW = Math.max(1, window.innerWidth);
    const winH = Math.max(1, window.innerHeight);
    const scaleX = winW / Math.max(1, this.logicalWidth);
    const scaleY = winH / Math.max(1, this.logicalHeight);
    const scaleAvg = (scaleX + scaleY) * 0.5;

    const baseDiameterPx = Math.round(leftJoy.maxRadius * 2 * scaleAvg);
    const knobDiameterPx = Math.round(40 * scaleAvg);
    const labelOffsetPx = Math.round((leftJoy.maxRadius + 15) * scaleAvg);

    // 1. Joystick Esquerdo (Movimento) em resolução nativa CSS/DOM
    const lx = Math.round(leftJoy.baseX * scaleX);
    const ly = Math.round(leftJoy.baseY * scaleY);
    const lkx = Math.round(leftJoy.knobX * scaleX);
    const lky = Math.round(leftJoy.knobY * scaleY);

    Object.assign(this.leftJoyBaseEl.style, {
      left: `${lx}px`,
      top: `${ly}px`,
      width: `${baseDiameterPx}px`,
      height: `${baseDiameterPx}px`,
      backgroundColor: leftJoy.active
        ? 'rgba(16, 23, 19, 0.50)'
        : 'rgba(16, 23, 19, 0.24)',
      borderColor: leftJoy.active
        ? 'rgba(100, 148, 120, 0.75)'
        : 'rgba(75, 107, 88, 0.45)',
    });

    Object.assign(this.leftJoyKnobEl.style, {
      left: `${lkx}px`,
      top: `${lky}px`,
      width: `${knobDiameterPx}px`,
      height: `${knobDiameterPx}px`,
      backgroundColor: leftJoy.active
        ? 'rgba(43, 149, 255, 0.88)'
        : 'rgba(43, 149, 255, 0.42)',
      borderColor: leftJoy.active
        ? 'rgba(216, 236, 255, 0.92)'
        : 'rgba(216, 236, 255, 0.55)',
    });

    Object.assign(this.leftJoyLabelEl.style, {
      left: `${lx}px`,
      top: `${ly + labelOffsetPx}px`,
    });

    // 2. Joystick Direito (Orientação da Visão) em resolução nativa CSS/DOM
    const rx = Math.round(rightJoy.baseX * scaleX);
    const ry = Math.round(rightJoy.baseY * scaleY);
    const rkx = Math.round(rightJoy.knobX * scaleX);
    const rky = Math.round(rightJoy.knobY * scaleY);

    Object.assign(this.rightJoyBaseEl.style, {
      left: `${rx}px`,
      top: `${ry}px`,
      width: `${baseDiameterPx}px`,
      height: `${baseDiameterPx}px`,
      backgroundColor: rightJoy.active
        ? 'rgba(31, 20, 14, 0.54)'
        : 'rgba(31, 20, 14, 0.28)',
      borderColor: rightJoy.active
        ? 'rgba(255, 138, 61, 0.80)'
        : 'rgba(255, 138, 61, 0.50)',
    });

    Object.assign(this.rightJoyKnobEl.style, {
      left: `${rkx}px`,
      top: `${rky}px`,
      width: `${knobDiameterPx}px`,
      height: `${knobDiameterPx}px`,
      backgroundColor: rightJoy.active
        ? 'rgba(255, 123, 41, 0.90)'
        : 'rgba(255, 123, 41, 0.46)',
      borderColor: rightJoy.active
        ? 'rgba(255, 228, 204, 0.95)'
        : 'rgba(255, 228, 204, 0.60)',
    });

    Object.assign(this.rightJoyLabelEl.style, {
      left: `${rx}px`,
      top: `${ry + labelOffsetPx}px`,
    });
  }
}
