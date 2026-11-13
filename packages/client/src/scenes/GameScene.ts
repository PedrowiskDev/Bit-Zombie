import Phaser from 'phaser';
import {
  BALANCE,
  normalizeInputVector,
  type AimMode,
  type GameMode,
  type PropKind,
  type Vec2,
  type ZombieKind,
} from '@zombie-coop/shared';
import { TEXTURE_KEYS } from '../assets/textureGenerator.js';
import { KeyboardController } from '../input/KeyboardController.js';
import { VirtualJoystick } from '../input/VirtualJoystick.js';
import { OfflineProvider } from '../network/OfflineProvider.js';
import { OnlineProvider } from '../network/OnlineProvider.js';
import type { FrameAimInput, IWorldProvider } from '../network/WorldProvider.js';
import { CombatEffectsManager } from '../ui/CombatEffects.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { EndGameModal, formatSurvivalTime } from '../ui/EndGameModal.js';
import { LobbyOverlay } from '../ui/LobbyOverlay.js';
import { UpgradePickerOverlay } from '../ui/UpgradePickerOverlay.js';

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

  private readonly playerSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly playerRings = new Map<string, Phaser.GameObjects.Arc>();
  private readonly playerRangeRings = new Map<string, Phaser.GameObjects.Arc>();
  private readonly zombieSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly zombieFlashTimers = new Map<number, number>();

  private zombieHpGraphics!: Phaser.GameObjects.Graphics;
  private manualAimGraphics!: Phaser.GameObjects.Graphics;
  private reviveGraphics!: Phaser.GameObjects.Graphics;
  private allyIndicatorGraphics!: Phaser.GameObjects.Graphics;
  private allyIndicatorText!: Phaser.GameObjects.Text;
  private propsGroup!: Phaser.GameObjects.Group;
  private cameraTargetId: string | null = null;

  private hudBarGraphics!: Phaser.GameObjects.Graphics;
  private hudStatusText!: Phaser.GameObjects.Text;
  private hudMetricsText!: Phaser.GameObjects.Text;
  private hudHintText!: Phaser.GameObjects.Text;
  private joystickLeftLabel!: Phaser.GameObjects.Text;
  private joystickRightLabel!: Phaser.GameObjects.Text;
  private joystickGraphics!: Phaser.GameObjects.Graphics;

  private hudAimModeBtn!: HTMLButtonElement;
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
      this.localAimMode = 'auto';
    }

    const debugEnabled = params.has('debug');

    this.provider = new OfflineProvider(
      'player-1',
      this.defaultSeed,
      this.selectedGameMode
    );
    this.currentSeedRendered = -1;
    this.cameraTargetId = null;
    this.playerSprites.clear();
    this.playerRings.clear();
    this.playerRangeRings.clear();
    this.zombieSprites.clear();
    this.zombieFlashTimers.clear();

    const state = this.provider.getRenderState();
    const { mapWidth, mapHeight } = state;

    // 1. Piso com ruído e manchas (4000x4000)
    const ground = this.add.tileSprite(0, 0, mapWidth, mapHeight, TEXTURE_KEYS.GROUND_TILE);
    ground.setOrigin(0, 0);
    ground.setDepth(0);

    // 2. Grade tática sutil e limites visíveis da arena (4000x4000)
    this.drawArenaBoundariesAndLandmarks(mapWidth, mapHeight);

    // 3. Props decorativos determinísticos sem colisão
    this.propsGroup = this.add.group();
    this.renderPropsForSeed(state.seed, state.props);

    // 4. Barra de vida dos zumbis, laser de mira manual, zona de resgate e gerenciador de efeitos de combate
    this.manualAimGraphics = this.add.graphics();
    this.manualAimGraphics.setDepth(8);
    this.reviveGraphics = this.add.graphics();
    this.reviveGraphics.setDepth(8);
    this.zombieHpGraphics = this.add.graphics();
    this.zombieHpGraphics.setDepth(13);
    this.combatEffects = new CombatEffectsManager(this);

    // 5. Configura limites da câmera top-down
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

    // 6. Inicializa controladores de entrada (WASD/Setas + Twin-Stick Virtual: Esquerda Mover, Direita Mirar/Atirar)
    const mountEl = document.getElementById('app') ?? document.body;
    this.keyboard = new KeyboardController();
    this.joystick = new VirtualJoystick(
      mountEl,
      this.logicalWidth,
      this.logicalHeight
    );

    // 7. Camada de HUD, Seletor de Modo de Tiro, Botão de Antecipar Rodada, Seletor de Upgrades Fase 2, Banner, Modal de Fim de Jogo e Lobby
    this.createHudOverlay();
    this.createHudDomControls();
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

    // Ajusta orientação inicial (Landscape 960x540 vs Portrait 540x960) e escuta redimensionamento
    this.syncViewportOrientation();
    this.onWindowResizeBound = () => this.syncViewportOrientation();
    window.addEventListener('resize', this.onWindowResizeBound);

    // Se ?mode=offline ou ?autostart=1 estiver na URL, inicia direto no modo offline
    if (params.get('mode') === 'offline' || params.get('autostart') === '1') {
      this.startOfflineMode(this.selectedGameMode, this.defaultSeed);
    } else {
      this.lobbyOverlay.showMenu();
    }

    // Atalhos de teclado: M alterna modo de tiro, N antecipa intervalo entre rodadas
    this.onToggleKeyBound = (ev: KeyboardEvent) => {
      if (this.lobbyOverlay.isVisible() || this.endGameModal.isVisible()) {
        return;
      }
      if (ev.code === 'KeyM') {
        this.setAimMode(this.localAimMode === 'auto' ? 'manual' : 'auto');
      } else if (ev.code === 'KeyN') {
        this.provider.skipRoundIntermission?.();
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
        this.processTransientEvents();
        this.combatEffects.update(16);
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

    // 8. Renderiza o estado inicial imediatamente
    this.syncWorldRender(0);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.onToggleKeyBound);
      window.removeEventListener('resize', this.onWindowResizeBound);
      void this.provider.disconnect?.();
      this.keyboard.destroy();
      this.joystick.destroy();
      this.upgradePicker.destroy();
      this.endGameModal.destroy();
      this.lobbyOverlay.destroy();
      this.debugOverlay.destroy();
      this.hudAimModeBtn.remove();
      this.hudSkipIntermissionBtn.remove();
      this.levelUpBannerEl.remove();
      this.combatEffects.clearAll();
    });
  }

  update(_time: number, deltaMs: number): void {
    const isBlockedByUi = this.endGameModal.isVisible() || this.lobbyOverlay.isVisible();
    const combinedInput = isBlockedByUi ? { x: 0, y: 0 } : this.readCombinedInput();
    const aimInput = isBlockedByUi
      ? { aimMode: this.localAimMode, aimX: 0, aimY: 0, firing: false }
      : this.readAimInput(combinedInput);

    this.provider.updateFrame(deltaMs, combinedInput, aimInput);
    this.processTransientEvents();
    this.combatEffects.update(deltaMs);
    this.updateLevelUpBanner(deltaMs);
    this.syncWorldRender(deltaMs);
    this.drawJoystickOverlay();
  }

  /**
   * Adapta dinamicamente a resolução do canvas à proporção exata da tela de cada aparelho
   * (`window.innerWidth x window.innerHeight`), eliminando tarjas pretas (100% de preenchimento)
   * e mantendo a diagonal lógica constante (~1101.4 px, meia-diagonal ~550.7 px < 580 px do anel de spawn).
   * Assim, qualquer celular (19.5:9, 20:9, 16:9), tablet (4:3) ou monitor usa toda a tela sem
   * ver zumbis nascendo dentro da câmera e sem vantagem injusta de campo de visão no coop.
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

    document.body.dataset.orientation = isPortrait ? 'portrait' : 'landscape';
    document.body.dataset.viewportW = String(targetW);
    document.body.dataset.viewportH = String(targetH);

    this.scale.setParentSize(winW, winH);

    if (this.logicalWidth !== targetW || this.logicalHeight !== targetH) {
      this.logicalWidth = targetW;
      this.logicalHeight = targetH;
      this.scale.setGameSize(targetW, targetH);
      this.cameras.main.setSize(targetW, targetH);
      this.joystick.setLogicalViewport(targetW, targetH);
    }

    this.scale.refresh();

    if (this.game.canvas) {
      this.game.canvas.style.width = `${winW}px`;
      this.game.canvas.style.height = `${winH}px`;
      this.game.canvas.style.marginLeft = '0px';
      this.game.canvas.style.marginTop = '0px';
    }

    if (this.hudHintText) {
      this.hudHintText.setPosition(
        this.logicalWidth / 2,
        isPortrait ? this.logicalHeight - 58 : this.logicalHeight - 66
      );
      this.hudHintText.setStyle({
        fontSize: this.logicalWidth < 520 ? '10px' : '11px',
      });
    }
  }

  private setAimMode(mode: AimMode): void {
    this.localAimMode = mode === 'manual' ? 'manual' : 'auto';
    this.lobbyOverlay?.setAimMode(this.localAimMode);
    this.refreshHudAimModeButton();
    document.body.dataset.aimMode = this.localAimMode;
  }

  private readAimInput(moveVector: Vec2): FrameAimInput {
    if (this.localAimMode === 'auto') {
      return {
        aimMode: 'auto',
        aimX: 0,
        aimY: 0,
        firing: false,
      };
    }

    const rightStick = this.joystick.getRightAimState();
    if (rightStick.active) {
      return {
        aimMode: 'manual',
        aimX: rightStick.aimX,
        aimY: rightStick.aimY,
        firing: rightStick.firing,
      };
    }

    return {
      aimMode: 'manual',
      aimX: moveVector.x,
      aimY: moveVector.y,
      firing: false,
    };
  }

  private startOfflineMode(
    gameMode: GameMode = this.selectedGameMode,
    seed: number = this.defaultSeed
  ): void {
    this.selectedGameMode = gameMode;
    this.defaultSeed = seed;
    void this.provider.disconnect?.();
    this.resetWorldEntities();
    this.provider = new OfflineProvider('player-1', seed, gameMode);
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
      this.selectedGameMode
    );
    this.endGameModal.hide();
    this.lobbyOverlay.showMenu();
    document.body.dataset.mode = 'offline';
  }

  private startOfflineFallbackWithMenuError(errorMessage: string): void {
    this.resetWorldEntities();
    this.provider = new OfflineProvider(
      'player-1',
      this.defaultSeed,
      this.selectedGameMode
    );
    this.endGameModal.hide();
    this.lobbyOverlay.showMenu(errorMessage);
    document.body.dataset.mode = 'offline';
  }

  private resetWorldEntities(): void {
    this.keyboard.clear();
    this.joystick.reset();
    this.combatEffects.clearAll();
    this.cameraTargetId = null;
    this.levelUpBannerTimerMs = 0;
    if (this.levelUpBannerEl) {
      this.levelUpBannerEl.style.display = 'none';
    }
    if (this.hudSkipIntermissionBtn) {
      this.hudSkipIntermissionBtn.style.display = 'none';
    }

    for (const sprite of this.playerSprites.values()) {
      sprite.destroy();
    }
    this.playerSprites.clear();
    for (const ring of this.playerRings.values()) {
      ring.destroy();
    }
    this.playerRings.clear();
    for (const rangeRing of this.playerRangeRings.values()) {
      rangeRing.destroy();
    }
    this.playerRangeRings.clear();

    for (const sprite of this.zombieSprites.values()) {
      sprite.destroy();
    }
    this.zombieSprites.clear();
    this.zombieFlashTimers.clear();
    this.zombieHpGraphics.clear();
    this.manualAimGraphics.clear();
    this.reviveGraphics?.clear();
    this.allyIndicatorGraphics?.clear();
    this.allyIndicatorText?.setVisible(false);
    this.upgradePicker?.update([], 0);
  }

  private processTransientEvents(): void {
    const events = this.provider.consumeNewEvents();
    const state = this.provider.getRenderState();
    const localPlayer = state.players.find((p) => p.id === state.localPlayerId);

    for (const ev of events) {
      if (ev.type === 'fire') {
        this.combatEffects.onWeaponFire(ev);
      } else if (ev.type === 'hit') {
        this.combatEffects.onProjectileHit(ev);
        if (!ev.killed) {
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
        this.levelUpBannerEl.textContent = `ALERTA DE HORDA #${ev.hordeNumber}! CHEGADA EM ${secs}s`;
        this.levelUpBannerEl.style.display = 'block';
        this.levelUpBannerTimerMs = 3400;
      } else if (ev.type === 'horde_started') {
        this.levelUpBannerEl.textContent = `HORDA #${ev.hordeNumber} EM CURSO! (${ev.totalZombies} INIMIGOS)`;
        this.levelUpBannerEl.style.display = 'block';
        this.levelUpBannerTimerMs = 3000;
      } else if (ev.type === 'horde_cleared') {
        this.levelUpBannerEl.textContent = `HORDA #${ev.hordeNumber} ELIMINADA! JANELA DE RECUPERAÇÃO`;
        this.levelUpBannerEl.style.display = 'block';
        this.levelUpBannerTimerMs = 3000;
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
    const state = this.provider.getRenderState();
    this.renderPropsForSeed(state.seed, state.props);
    this.syncWorldRender(0);
    document.body.dataset.state = 'playing';
  }

  private readCombinedInput(): Vec2 {
    const kb = this.keyboard.getVector();
    const joy = this.joystick.getVector();

    if (joy.x !== 0 || joy.y !== 0) {
      return normalizeInputVector(joy.x, joy.y);
    }
    return kb;
  }

  private syncWorldRender(deltaMs: number): void {
    const state = this.provider.getRenderState();
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
    this.hudAimModeBtn.style.display = showInGameHudBtn ? 'block' : 'none';
    this.updateSkipIntermissionButton(state, showInGameHudBtn);

    this.manualAimGraphics.clear();
    this.reviveGraphics.clear();

    // 1. Atualiza jogadores (Jogador 1 Azul colorIndex 0, Jogador 2 Laranja colorIndex 1)
    const activePlayerIds = new Set<string>();
    for (const p of state.players) {
      activePlayerIds.add(p.id);

      let sprite = this.playerSprites.get(p.id);
      let ring = this.playerRings.get(p.id);
      let rangeRing = this.playerRangeRings.get(p.id);

      if (!sprite || !ring || !rangeRing) {
        const texKey =
          p.colorIndex % 2 === 0 ? TEXTURE_KEYS.PLAYER_BLUE : TEXTURE_KEYS.PLAYER_ORANGE;
        const ringColor = p.colorIndex % 2 === 0 ? 0x2b95ff : 0xff7b29;

        rangeRing = this.add.circle(p.x, p.y, BALANCE.PISTOL.RANGE_PX);
        rangeRing.setStrokeStyle(1, ringColor, 0.14);
        rangeRing.setDepth(3);

        ring = this.add.circle(p.x, p.y, p.radius, ringColor, 0.16);
        ring.setStrokeStyle(1.5, ringColor, 0.7);
        ring.setDepth(9);

        sprite = this.add.image(p.x, p.y, texKey);
        sprite.setDepth(10);

        this.playerRangeRings.set(p.id, rangeRing);
        this.playerRings.set(p.id, ring);
        this.playerSprites.set(p.id, sprite);
      }

      rangeRing.setPosition(p.x, p.y);
      ring.setPosition(p.x, p.y);
      sprite.setPosition(p.x, p.y);
      sprite.setRotation(p.facingAngle);

      const baseRingColor = p.colorIndex % 2 === 0 ? 0x2b95ff : 0xff7b29;

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

      if (p.id === state.localPlayerId && this.cameraTargetId !== p.id) {
        this.cameras.main.startFollow(sprite, true, 1, 1);
        this.cameraTargetId = p.id;
      }

      // Desenha linha guia de mira tática quando o jogador local está no modo Manual
      if (p.id === state.localPlayerId && p.alive && this.localAimMode === 'manual') {
        const rightStick = this.joystick.getRightAimState();
        const dirX = Math.cos(p.facingAngle);
        const dirY = Math.sin(p.facingAngle);
        const startX = p.x + dirX * (p.radius + 6);
        const startY = p.y + dirY * (p.radius + 6);
        const endX = p.x + dirX * BALANCE.PISTOL.RANGE_PX;
        const endY = p.y + dirY * BALANCE.PISTOL.RANGE_PX;
        const laserAlpha = rightStick.active ? 0.65 : 0.25;

        this.manualAimGraphics.lineStyle(1.5, 0xff8a3d, laserAlpha);
        this.manualAimGraphics.beginPath();
        this.manualAimGraphics.moveTo(startX, startY);
        this.manualAimGraphics.lineTo(endX, endY);
        this.manualAimGraphics.strokePath();
        this.manualAimGraphics.fillStyle(0xff8a3d, laserAlpha + 0.15);
        this.manualAimGraphics.fillCircle(endX, endY, 4);
      }

      if (p.id === state.localPlayerId) {
        this.updateHud(state, p.hp, p.maxHp);
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
        document.body.dataset.gameMode = state.gameMode;
        document.body.dataset.seed = String(state.seed);
        document.body.dataset.playerX = String(rx);
        document.body.dataset.playerY = String(ry);
        document.body.dataset.playerHp = String(Math.round(p.hp));
        document.body.dataset.playerMaxHp = String(Math.round(p.maxHp));
        document.body.dataset.zombiesAlive = String(state.zombies.length);
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
        this.playerRangeRings.get(id)?.destroy();
        this.playerRangeRings.delete(id);
      }
    }

    // Indicador de direção do aliado fora da tela (Coop 2 jogadores)
    this.updateOffscreenAllyIndicator(state);

    // 2. Atualiza zumbis vivos e barras de vida
    this.zombieHpGraphics.clear();
    const activeZombieIds = new Set<number>();

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
      if (z.isElite) {
        zSprite.setScale(
          BALANCE.ROUNDS.ELITE_RADIUS_PX / BALANCE.ZOMBIES.BRUTE.RADIUS
        );
      } else {
        zSprite.setScale(1);
      }

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
          zSprite.clearTint();
        }
      }

      // Aura dourada/carmesim para inimigo de Elite (a cada 5 rodadas ou horda especial)
      if (z.isElite) {
        this.zombieHpGraphics.lineStyle(2.5, 0xffc83b, 0.92);
        this.zombieHpGraphics.strokeCircle(z.x, z.y, z.radius + 5);
      }

      // Desenha barra de HP para zumbis feridos ou Elites
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

    for (const [id, sprite] of this.zombieSprites.entries()) {
      if (!activeZombieIds.has(id)) {
        sprite.destroy();
        this.zombieSprites.delete(id);
        this.zombieFlashTimers.delete(id);
      }
    }

    // 3. Verifica Fim de Jogo (e oculta modal se outro jogador reiniciou a partida no coop)
    if (state.gameOver && !this.endGameModal.isVisible()) {
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

    // 4. Atualiza painel ?debug se estiver ativo
    this.debugOverlay.update(this.game.loop.actualFps || 60, state);
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
    state: ReturnType<IWorldProvider['getRenderState']>
  ): void {
    this.allyIndicatorGraphics.clear();
    const localPlayer = state.players.find((p) => p.id === state.localPlayerId);
    const ally = state.players.find(
      (p) => p.id !== state.localPlayerId && p.connected
    );

    if (!localPlayer || !ally) {
      this.allyIndicatorText.setVisible(false);
      return;
    }

    const cam = this.cameras.main;
    const margin = 36;
    const isInsideView =
      ally.x >= cam.scrollX + margin &&
      ally.x <= cam.scrollX + this.logicalWidth - margin &&
      ally.y >= cam.scrollY + margin &&
      ally.y <= cam.scrollY + this.logicalHeight - margin;

    if (isInsideView) {
      this.allyIndicatorText.setVisible(false);
      return;
    }

    const angle = Math.atan2(ally.y - localPlayer.y, ally.x - localPlayer.x);
    const centerX = this.logicalWidth / 2;
    const centerY = this.logicalHeight / 2;
    const radiusX = centerX - 48;
    const radiusY = centerY - 56;
    const indX = centerX + Math.cos(angle) * radiusX;
    const indY = centerY + Math.sin(angle) * radiusY;
    const isDowned = !ally.alive;
    const allyColor = isDowned
      ? 0xff4c4c
      : ally.colorIndex % 2 === 0
        ? 0x2b95ff
        : 0xff7b29;

    this.allyIndicatorGraphics.fillStyle(0x0f1411, 0.92);
    this.allyIndicatorGraphics.lineStyle(2, allyColor, 0.95);
    this.allyIndicatorGraphics.fillCircle(indX, indY, isDowned ? 18 : 14);
    this.allyIndicatorGraphics.strokeCircle(indX, indY, isDowned ? 18 : 14);

    this.allyIndicatorText.setVisible(true);
    this.allyIndicatorText.setText(isDowned ? 'SOS' : 'P2');
    this.allyIndicatorText.setPosition(indX, indY);
    this.allyIndicatorText.setColor(
      isDowned ? '#ff7a7a' : ally.colorIndex % 2 === 0 ? '#6db8ff' : '#ff9d5c'
    );
  }

  private getZombieTextureKey(kind: ZombieKind): string {
    switch (kind) {
      case 'fast':
        return TEXTURE_KEYS.ZOMBIE_FAST;
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
    const isNarrow = this.logicalWidth < 560;
    const pad = isNarrow ? 10 : 16;
    const boxW = Math.min(585, this.logicalWidth - pad * 2);
    const barW = Math.floor((boxW - 36) / 2);

    const hpRatio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
    const xpRatio = Math.max(0, Math.min(1, state.xp / Math.max(1, state.xpToNextLevel)));

    this.hudBarGraphics.clear();

    // Fundo do cluster de status
    this.hudBarGraphics.fillStyle(0x0f1411, 0.86);
    this.hudBarGraphics.lineStyle(1, 0x2e3b33, 0.9);
    this.hudBarGraphics.fillRoundedRect(pad, pad, boxW, 68, 6);
    this.hudBarGraphics.strokeRoundedRect(pad, pad, boxW, 68, 6);

    // Barra de Vida (HP)
    const barX = pad + 10;
    const hpBarY = pad + 32;
    this.hudBarGraphics.fillStyle(0x1f2822, 1);
    this.hudBarGraphics.fillRoundedRect(barX, hpBarY, barW, 10, 3);
    this.hudBarGraphics.fillStyle(hpRatio > 0.3 ? 0x38b865 : 0xe04848, 1);
    if (hpRatio > 0) {
      this.hudBarGraphics.fillRoundedRect(barX, hpBarY, Math.max(4, barW * hpRatio), 10, 3);
    }

    // Barra de XP Compartilhado
    const xpBarX = barX + barW + 16;
    this.hudBarGraphics.fillStyle(0x1f2822, 1);
    this.hudBarGraphics.fillRoundedRect(xpBarX, hpBarY, barW, 10, 3);
    this.hudBarGraphics.fillStyle(0x3b9eff, 1);
    if (xpRatio > 0) {
      this.hudBarGraphics.fillRoundedRect(
        xpBarX,
        hpBarY,
        Math.max(4, barW * xpRatio),
        10,
        3
      );
    }

    this.hudStatusText.setPosition(pad + 10, pad + 10);
    this.hudStatusText.setStyle({ fontSize: isNarrow ? '11px' : '13px' });
    this.hudMetricsText.setPosition(pad + 10, pad + 48);
    this.hudMetricsText.setStyle({ fontSize: isNarrow ? '10px' : '11px' });

    const timeFormatted = formatSurvivalTime(state.elapsedMs);
    const roomLabel =
      state.roomCode === 'SOLO'
        ? isNarrow
          ? 'SOLO'
          : 'MODO SOLO'
        : `SALA ${state.roomCode}`;

    this.hudStatusText.setText(
      isNarrow
        ? `HP ${Math.round(hp)}/${maxHp} · NV ${state.level} (XP ${state.xp}/${state.xpToNextLevel}) · ${timeFormatted}`
        : `HP ${Math.round(hp)}/${maxHp}   ·   NV ${state.level} (XP ${state.xp}/${state.xpToNextLevel})   ·   TEMPO ${timeFormatted}`
    );

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

      this.hudMetricsText.setText(
        isNarrow
          ? `EXPLORAÇÃO · DIA ${exp.daysSurvived} · ${phaseTag} · SETORES ${exp.sectorsExplored} · ABATES ${state.kills}`
          : `EXPLORAÇÃO  ·  DIA ${exp.daysSurvived}  ·  ${phaseTag}  ·  SETORES ${exp.sectorsExplored}  ·  ABATES ${state.kills}  ·  ${roomLabel}`
      );
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

      this.hudMetricsText.setText(
        isNarrow
          ? `${rPhase} · ABATES ${state.kills} · DANO ${Math.round(state.totalDamageDealt)} · ${roomLabel}`
          : `${rPhase}  ·  ABATES ${state.kills}  ·  DANO ${Math.round(state.totalDamageDealt)}  ·  RESGATES ${state.totalRevives}  ·  ${roomLabel}`
      );
    }

    if (this.localAimMode === 'manual') {
      this.hudHintText.setText(
        isNarrow
          ? 'Esquerda: Mover · Direita: Mirar e Atirar · (M) Auto'
          : 'Metade Esquerda / WASD: Mover  ·  Metade Direita: Toque e arraste para Mirar e Atirar  ·  Tecla M: Modo Auto'
      );
    } else {
      this.hudHintText.setText(
        isNarrow
          ? 'Esquerda: Mover · Tiro Automático (320px) · (M) Manual'
          : 'Metade Esquerda / WASD: Mover  ·  Mira e Tiro Automáticos (320 px)  ·  Tecla M: Mudar para Tiro Manual'
      );
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

    const kindToTexture: Record<PropKind, string> = {
      car: TEXTURE_KEYS.PROP_CAR,
      crate: TEXTURE_KEYS.PROP_CRATE,
      bush: TEXTURE_KEYS.PROP_BUSH,
      rubble: TEXTURE_KEYS.PROP_RUBBLE,
    };

    for (const prop of props) {
      const key = kindToTexture[prop.kind];
      const img = this.add.image(prop.x, prop.y, key);
      img.setRotation(prop.rotation);
      img.setScale(prop.scale);
      img.setDepth(prop.kind === 'rubble' ? 2 : 4);
      this.propsGroup.add(img);
    }
  }

  private drawArenaBoundariesAndLandmarks(mapWidth: number, mapHeight: number): void {
    const g = this.add.graphics();
    g.setDepth(1);

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

  private createHudOverlay(): void {
    const pad = 16;

    this.hudBarGraphics = this.add.graphics();
    this.hudBarGraphics.setScrollFactor(0);
    this.hudBarGraphics.setDepth(100);

    this.hudStatusText = this.add.text(pad + 12, pad + 10, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#e6ece8',
      fontStyle: 'bold',
    });
    this.hudStatusText.setScrollFactor(0);
    this.hudStatusText.setDepth(101);

    this.hudMetricsText = this.add.text(pad + 12, pad + 48, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#9fb0a5',
    });
    this.hudMetricsText.setScrollFactor(0);
    this.hudMetricsText.setDepth(101);

    this.hudHintText = this.add.text(
      this.logicalWidth / 2,
      this.logicalHeight - 52,
      '',
      {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        color: '#a8b8ae',
        backgroundColor: '#0f1411cc',
        padding: { x: 10, y: 4 },
      }
    );
    this.hudHintText.setOrigin(0.5, 1);
    this.hudHintText.setScrollFactor(0);
    this.hudHintText.setDepth(101);

    this.allyIndicatorGraphics = this.add.graphics();
    this.allyIndicatorGraphics.setScrollFactor(0);
    this.allyIndicatorGraphics.setDepth(101);

    this.allyIndicatorText = this.add.text(0, 0, 'P2', {
      fontFamily: 'monospace',
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#ff9d5c',
    });
    this.allyIndicatorText.setOrigin(0.5, 0.5);
    this.allyIndicatorText.setScrollFactor(0);
    this.allyIndicatorText.setDepth(102);
    this.allyIndicatorText.setVisible(false);

    this.joystickGraphics = this.add.graphics();
    this.joystickGraphics.setScrollFactor(0);
    this.joystickGraphics.setDepth(102);

    this.joystickLeftLabel = this.add.text(136, 484, 'MOVER', {
      fontFamily: 'monospace',
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#7ab8ff',
    });
    this.joystickLeftLabel.setOrigin(0.5, 0.5);
    this.joystickLeftLabel.setScrollFactor(0);
    this.joystickLeftLabel.setDepth(103);

    this.joystickRightLabel = this.add.text(
      this.logicalWidth - 136,
      484,
      'MIRAR / ATIRAR',
      {
        fontFamily: 'monospace',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#ff9d5c',
      }
    );
    this.joystickRightLabel.setOrigin(0.5, 0.5);
    this.joystickRightLabel.setScrollFactor(0);
    this.joystickRightLabel.setDepth(103);
  }

  private createHudDomControls(): void {
    // Botão interativo na HUD para alternar Tiro Automático vs Manual (Lado Direito)
    this.hudAimModeBtn = document.createElement('button');
    this.hudAimModeBtn.type = 'button';
    this.hudAimModeBtn.setAttribute('data-testid', 'btn-hud-aim-mode');
    Object.assign(this.hudAimModeBtn.style, {
      position: 'fixed',
      bottom: 'calc(10px + var(--safe-bottom))',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '6px 14px',
      minHeight: '32px',
      fontFamily: 'monospace',
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

    // Botão para antecipar a próxima rodada durante o intervalo de 25s no Modo 1
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
      fontFamily: 'monospace',
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

    // Banner flutuante ao subir de nível ou mudar fase de rodada/horda
    this.levelUpBannerEl = document.createElement('div');
    this.levelUpBannerEl.setAttribute('data-testid', 'level-up-banner');
    Object.assign(this.levelUpBannerEl.style, {
      position: 'fixed',
      top: 'calc(134px + var(--safe-top))',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'none',
      maxWidth: '92vw',
      textAlign: 'center',
      backgroundColor: 'rgba(18, 38, 26, 0.94)',
      border: '1.5px solid #58d682',
      borderRadius: '8px',
      padding: '8px 14px',
      fontFamily: 'monospace',
      fontSize: '12px',
      fontWeight: '800',
      color: '#a3ffd0',
      zIndex: '32',
      pointerEvents: 'none',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
    });
    document.body.appendChild(this.levelUpBannerEl);
  }

  private refreshHudAimModeButton(): void {
    if (!this.hudAimModeBtn) {
      return;
    }
    const isAuto = this.localAimMode === 'auto';
    this.hudAimModeBtn.textContent = isAuto
      ? 'TIRO: AUTOMÁTICO (M)'
      : 'TIRO: MANUAL · DIREITA (M)';
    Object.assign(this.hudAimModeBtn.style, {
      backgroundColor: isAuto ? 'rgba(24, 52, 35, 0.92)' : 'rgba(64, 34, 16, 0.92)',
      border: isAuto ? '1px solid #52c478' : '1px solid #ff9138',
      color: isAuto ? '#8cf5ad' : '#ffc288',
    });
  }

  private drawJoystickOverlay(): void {
    const leftJoy = this.joystick.getVisualState();
    const rightJoy = this.joystick.getRightVisualState();
    this.joystickGraphics.clear();

    if (this.endGameModal.isVisible() || this.lobbyOverlay.isVisible()) {
      this.joystickLeftLabel.setVisible(false);
      this.joystickRightLabel.setVisible(false);
      return;
    }

    // 1. Joystick Esquerdo (Movimento)
    this.joystickLeftLabel.setVisible(true);
    this.joystickLeftLabel.setPosition(leftJoy.baseX, leftJoy.baseY + leftJoy.maxRadius + 14);

    const leftBaseAlpha = leftJoy.active ? 0.45 : 0.18;
    const leftKnobAlpha = leftJoy.active ? 0.85 : 0.32;

    this.joystickGraphics.fillStyle(0x101713, leftBaseAlpha);
    this.joystickGraphics.fillCircle(leftJoy.baseX, leftJoy.baseY, leftJoy.maxRadius);
    this.joystickGraphics.lineStyle(2, 0x4b6b58, leftBaseAlpha + 0.15);
    this.joystickGraphics.strokeCircle(leftJoy.baseX, leftJoy.baseY, leftJoy.maxRadius);

    this.joystickGraphics.fillStyle(0x2b95ff, leftKnobAlpha);
    this.joystickGraphics.fillCircle(leftJoy.knobX, leftJoy.knobY, 20);
    this.joystickGraphics.lineStyle(1.5, 0xd8ecff, leftKnobAlpha);
    this.joystickGraphics.strokeCircle(leftJoy.knobX, leftJoy.knobY, 20);

    // 2. Joystick Direito (Mira e Tiro Manual no lado direito da tela)
    if (this.localAimMode === 'manual') {
      this.joystickRightLabel.setVisible(true);
      this.joystickRightLabel.setPosition(
        rightJoy.baseX,
        rightJoy.baseY + rightJoy.maxRadius + 14
      );

      const rightBaseAlpha = rightJoy.active ? 0.5 : 0.24;
      const rightKnobAlpha = rightJoy.active ? 0.9 : 0.42;

      this.joystickGraphics.fillStyle(0x1f140e, rightBaseAlpha);
      this.joystickGraphics.fillCircle(rightJoy.baseX, rightJoy.baseY, rightJoy.maxRadius);
      this.joystickGraphics.lineStyle(2, 0xff8a3d, rightBaseAlpha + 0.2);
      this.joystickGraphics.strokeCircle(
        rightJoy.baseX,
        rightJoy.baseY,
        rightJoy.maxRadius
      );

      this.joystickGraphics.fillStyle(0xff7b29, rightKnobAlpha);
      this.joystickGraphics.fillCircle(rightJoy.knobX, rightJoy.knobY, 20);
      this.joystickGraphics.lineStyle(1.5, 0xffe4cc, rightKnobAlpha);
      this.joystickGraphics.strokeCircle(rightJoy.knobX, rightJoy.knobY, 20);
    } else {
      this.joystickRightLabel.setVisible(false);
    }
  }
}
