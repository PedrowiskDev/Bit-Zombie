import {
  BALANCE,
  type AimMode,
  type GameMode,
  type PlayerStateSnapshot,
  type RoomPhase,
} from '@zombie-coop/shared';

export interface LobbyActions {
  onStartOffline: (gameMode: GameMode, seed: number) => void;
  onCreatePrivateRoom: (gameMode: GameMode, seed: number) => Promise<void>;
  onJoinPrivateRoom: (code: string) => Promise<void>;
  onToggleReady: () => void;
  onLeaveRoom: () => Promise<void>;
  onChangeAimMode: (mode: AimMode) => void;
  onChangeGameMode?: (mode: GameMode) => void;
}

/**
 * Menu Principal e Lobby de Sala Privada (Etapa 1 do Novo Plano + Etapas 4 e 5).
 * - Permite escolher o Modo de Jogo:
 *   1. Sobrevivência por Rodadas (`rounds`)
 *   2. Exploração e Abrigo (`exploration`)
 * - Permite escolher/sortear a Seed do mapa-base para reproduzir exatamente a mesma geografia nos dois modos.
 * - Dentro de cada modo: Solo (Offline), Criar Sala Privada (2 jogadores) e Entrar por código de 5 caracteres.
 * - O segundo jogador recebe e visualiza o Modo de Jogo e a Seed escolhidos pelo criador no lobby.
 */
export class LobbyOverlay {
  private readonly root: HTMLDivElement;
  private readonly menuView: HTMLDivElement;
  private readonly roomView: HTMLDivElement;
  private readonly errorBanner: HTMLDivElement;
  private readonly codeInput: HTMLInputElement;
  private readonly seedInput: HTMLInputElement;
  private readonly roomCodeDisplay: HTMLSpanElement;
  private readonly lobbyModeBadge: HTMLSpanElement;
  private readonly lobbySeedBadge: HTMLSpanElement;
  private readonly phaseStatusText: HTMLParagraphElement;
  private readonly slotBlueEl: HTMLDivElement;
  private readonly slotOrangeEl: HTMLDivElement;
  private readonly readyBtn: HTMLButtonElement;
  private readonly aimAutoBtn: HTMLButtonElement;
  private readonly aimManualBtn: HTMLButtonElement;
  private readonly modeRoundsBtn: HTMLButtonElement;
  private readonly modeExplorationBtn: HTMLButtonElement;
  private readonly modeSummaryText: HTMLDivElement;
  private currentAimMode: AimMode = 'auto';
  private currentGameMode: GameMode = 'rounds';
  private currentSeed: number = BALANCE.SIMULATION.DEFAULT_SEED;
  private visible = true;

  constructor(
    private readonly actions: LobbyActions,
    initialSeed: number = BALANCE.SIMULATION.DEFAULT_SEED,
    initialGameMode: GameMode = 'rounds'
  ) {
    this.currentSeed = initialSeed;
    this.currentGameMode = initialGameMode;

    this.root = document.createElement('div');
    this.root.id = 'lobby-overlay';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(10, 14, 12, 0.88)',
      zIndex: '40',
      pointerEvents: 'auto',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#e6ece8',
      padding: '12px',
      overflowY: 'auto',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(95vw, 500px)',
      backgroundColor: '#121814',
      border: '1px solid #2e3d33',
      borderRadius: '10px',
      padding: '18px 20px',
      boxShadow: '0 20px 48px rgba(0, 0, 0, 0.75)',
    });

    // Emblema SVG de título
    const header = document.createElement('div');
    header.style.textAlign = 'center';
    header.style.marginBottom = '12px';
    header.innerHTML = `
      <svg viewBox="0 0 360 60" width="100%" height="50" aria-hidden="true" style="display:block;margin:0 auto 2px auto;">
        <rect x="6" y="6" width="348" height="48" rx="6" fill="#18211b" stroke="#3b5243" stroke-width="1.5"/>
        <circle cx="34" cy="30" r="11" fill="#2b95ff" />
        <circle cx="326" cy="30" r="11" fill="#ff7b29" />
        <text x="180" y="29" text-anchor="middle" fill="#e6ece8" font-family="monospace" font-weight="800" font-size="17" letter-spacing="2">ZOMBIE SURVIVAL</text>
        <text x="180" y="45" text-anchor="middle" fill="#63cf88" font-family="monospace" font-weight="700" font-size="10" letter-spacing="2.5">COOP · RODADAS &amp; EXPLORAÇÃO</text>
      </svg>
    `;

    // Banner de erro de rede / validação
    this.errorBanner = document.createElement('div');
    this.errorBanner.setAttribute('data-testid', 'lobby-error-banner');
    this.errorBanner.setAttribute('role', 'alert');
    Object.assign(this.errorBanner.style, {
      display: 'none',
      backgroundColor: '#3a181c',
      border: '1px solid #b84a54',
      color: '#ffccd0',
      padding: '9px 12px',
      borderRadius: '6px',
      fontSize: '12px',
      marginBottom: '10px',
      textAlign: 'center',
    });

    // 1. Sub-view do Menu Inicial
    this.menuView = document.createElement('div');

    // Seletor de Modo de Jogo (Etapa 1: Sobrevivência por Rodadas vs Exploração e Abrigo)
    const gameModeBox = document.createElement('div');
    Object.assign(gameModeBox.style, {
      backgroundColor: '#161e19',
      border: '1px solid #2b3b31',
      borderRadius: '8px',
      padding: '10px 12px',
      marginBottom: '10px',
    });

    const gameModeTitle = document.createElement('div');
    gameModeTitle.textContent = 'MODO DE JOGO (MESMO MAPA-BASE PELA SEED)';
    Object.assign(gameModeTitle.style, {
      fontSize: '11px',
      fontWeight: '700',
      color: '#95ab9d',
      letterSpacing: '0.06em',
      marginBottom: '8px',
      textAlign: 'center',
    });

    const gameModeBtnRow = document.createElement('div');
    Object.assign(gameModeBtnRow.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '8px',
      marginBottom: '8px',
    });

    this.modeRoundsBtn = document.createElement('button');
    this.modeRoundsBtn.type = 'button';
    this.modeRoundsBtn.textContent = 'Sobrevivência por Rodadas';
    this.modeRoundsBtn.setAttribute('data-testid', 'btn-mode-rounds');
    this.modeRoundsBtn.addEventListener('click', () => {
      this.modeRoundsBtn.blur();
      this.setGameMode('rounds');
      this.actions.onChangeGameMode?.('rounds');
    });

    this.modeExplorationBtn = document.createElement('button');
    this.modeExplorationBtn.type = 'button';
    this.modeExplorationBtn.textContent = 'Exploração e Abrigo';
    this.modeExplorationBtn.setAttribute('data-testid', 'btn-mode-exploration');
    this.modeExplorationBtn.addEventListener('click', () => {
      this.modeExplorationBtn.blur();
      this.setGameMode('exploration');
      this.actions.onChangeGameMode?.('exploration');
    });

    gameModeBtnRow.append(this.modeRoundsBtn, this.modeExplorationBtn);

    this.modeSummaryText = document.createElement('div');
    this.modeSummaryText.setAttribute('data-testid', 'menu-mode-summary');
    Object.assign(this.modeSummaryText.style, {
      fontSize: '11px',
      color: '#b8ccc0',
      lineHeight: '1.35',
      textAlign: 'center',
      marginBottom: '8px',
    });

    // Linha de Seed do Mapa
    const seedRow = document.createElement('div');
    Object.assign(seedRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      paddingTop: '8px',
      borderTop: '1px solid #233028',
    });

    const seedLabel = document.createElement('label');
    seedLabel.htmlFor = 'map-seed-input';
    seedLabel.textContent = 'SEED DO MAPA:';
    Object.assign(seedLabel.style, {
      fontSize: '11px',
      fontWeight: '700',
      color: '#8aa093',
      whiteSpace: 'nowrap',
    });

    this.seedInput = document.createElement('input');
    this.seedInput.id = 'map-seed-input';
    this.seedInput.type = 'number';
    this.seedInput.min = '1';
    this.seedInput.max = '2147483647';
    this.seedInput.value = String(this.currentSeed);
    this.seedInput.setAttribute('data-testid', 'input-map-seed');
    Object.assign(this.seedInput.style, {
      flex: '1',
      padding: '6px 8px',
      fontSize: '12px',
      fontFamily: 'monospace',
      fontWeight: '700',
      backgroundColor: '#0c100e',
      color: '#d8f3e0',
      border: '1px solid #35473b',
      borderRadius: '5px',
    });
    this.seedInput.addEventListener('change', () => {
      this.currentSeed = this.readValidatedSeed();
      this.seedInput.value = String(this.currentSeed);
    });

    const randomSeedBtn = document.createElement('button');
    randomSeedBtn.type = 'button';
    randomSeedBtn.textContent = 'Sortear';
    randomSeedBtn.setAttribute('data-testid', 'btn-random-seed');
    Object.assign(randomSeedBtn.style, {
      padding: '6px 10px',
      fontSize: '11px',
      fontWeight: '700',
      backgroundColor: '#233229',
      color: '#b8d8c3',
      border: '1px solid #385042',
      borderRadius: '5px',
      cursor: 'pointer',
    });
    randomSeedBtn.addEventListener('click', () => {
      randomSeedBtn.blur();
      this.currentSeed = Math.floor(Math.random() * 900000) + 100000;
      this.seedInput.value = String(this.currentSeed);
    });

    seedRow.append(seedLabel, this.seedInput, randomSeedBtn);
    gameModeBox.append(gameModeTitle, gameModeBtnRow, this.modeSummaryText, seedRow);
    this.refreshGameModeStyles();

    // Seletor de Modo de Disparo (Automático vs Manual no lado direito)
    const aimModeBox = document.createElement('div');
    Object.assign(aimModeBox.style, {
      backgroundColor: '#161e19',
      border: '1px solid #2b3b31',
      borderRadius: '8px',
      padding: '9px 12px',
      marginBottom: '12px',
    });

    const aimTitle = document.createElement('div');
    aimTitle.textContent = 'MODO DE DISPARO (TAMBÉM ALTERNÁVEL EM JOGO)';
    Object.assign(aimTitle.style, {
      fontSize: '11px',
      fontWeight: '700',
      color: '#95ab9d',
      letterSpacing: '0.06em',
      marginBottom: '6px',
      textAlign: 'center',
    });

    const aimBtnRow = document.createElement('div');
    Object.assign(aimBtnRow.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '8px',
    });

    this.aimAutoBtn = document.createElement('button');
    this.aimAutoBtn.type = 'button';
    this.aimAutoBtn.textContent = 'Automático (Padrão)';
    this.aimAutoBtn.setAttribute('data-testid', 'btn-aim-mode-auto');
    this.aimAutoBtn.addEventListener('click', () => {
      this.aimAutoBtn.blur();
      this.setAimMode('auto');
      this.actions.onChangeAimMode('auto');
    });

    this.aimManualBtn = document.createElement('button');
    this.aimManualBtn.type = 'button';
    this.aimManualBtn.textContent = 'Manual (Lado Direito)';
    this.aimManualBtn.setAttribute('data-testid', 'btn-aim-mode-manual');
    this.aimManualBtn.addEventListener('click', () => {
      this.aimManualBtn.blur();
      this.setAimMode('manual');
      this.actions.onChangeAimMode('manual');
    });

    aimBtnRow.append(this.aimAutoBtn, this.aimManualBtn);
    aimModeBox.append(aimTitle, aimBtnRow);
    this.refreshAimModeStyles();

    const offlineBtn = document.createElement('button');
    offlineBtn.type = 'button';
    offlineBtn.textContent = 'Jogar Solo (Offline)';
    offlineBtn.setAttribute('data-start', 'true');
    offlineBtn.setAttribute('data-testid', 'btn-play-offline');
    Object.assign(offlineBtn.style, {
      width: '100%',
      padding: '11px 16px',
      fontSize: '15px',
      fontWeight: '700',
      backgroundColor: '#38b865',
      color: '#0c0f0d',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      marginBottom: '8px',
    });
    offlineBtn.addEventListener('click', () => {
      offlineBtn.blur();
      this.clearError();
      this.actions.onStartOffline(this.currentGameMode, this.readValidatedSeed());
    });

    const createRoomBtn = document.createElement('button');
    createRoomBtn.type = 'button';
    createRoomBtn.textContent = 'Criar Sala Privada (Coop 2 Jogadores)';
    createRoomBtn.setAttribute('data-testid', 'btn-create-room');
    Object.assign(createRoomBtn.style, {
      width: '100%',
      padding: '10px 16px',
      fontSize: '14px',
      fontWeight: '700',
      backgroundColor: '#2b95ff',
      color: '#08121e',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      marginBottom: '12px',
    });
    createRoomBtn.addEventListener('click', () => {
      createRoomBtn.blur();
      this.clearError();
      void this.actions.onCreatePrivateRoom(
        this.currentGameMode,
        this.readValidatedSeed()
      );
    });

    const joinForm = document.createElement('div');
    Object.assign(joinForm.style, {
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      paddingTop: '10px',
      borderTop: '1px solid #243028',
    });

    const codeLabel = document.createElement('label');
    codeLabel.htmlFor = 'room-code-input';
    codeLabel.textContent = 'Código da Sala (5 caracteres)';
    Object.assign(codeLabel.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      clip: 'rect(0,0,0,0)',
    });

    this.codeInput = document.createElement('input');
    this.codeInput.id = 'room-code-input';
    this.codeInput.type = 'text';
    this.codeInput.maxLength = 5;
    this.codeInput.placeholder = 'CÓDIGO (EX: K7M4P)';
    this.codeInput.setAttribute('aria-label', 'Código da Sala de 5 caracteres');
    this.codeInput.setAttribute('data-testid', 'input-room-code');
    Object.assign(this.codeInput.style, {
      flex: '1',
      padding: '9px 12px',
      fontSize: '14px',
      fontFamily: 'monospace',
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: '0.12em',
      backgroundColor: '#0c100e',
      color: '#ffffff',
      border: '1px solid #35473b',
      borderRadius: '6px',
    });

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.textContent = 'Entrar por Código';
    joinBtn.setAttribute('data-testid', 'btn-join-room');
    Object.assign(joinBtn.style, {
      padding: '9px 14px',
      fontSize: '13px',
      fontWeight: '700',
      backgroundColor: '#ff7b29',
      color: '#1a0b02',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    });
    joinBtn.addEventListener('click', () => {
      joinBtn.blur();
      this.clearError();
      void this.actions.onJoinPrivateRoom(this.codeInput.value);
    });

    joinForm.append(codeLabel, this.codeInput, joinBtn);

    const footerHint = document.createElement('p');
    footerHint.textContent =
      'Esquerda: Mover · Direita: Mirar/Atirar · Tecla M: Mira · Tecla N: Antecipar Rodada';
    Object.assign(footerHint.style, {
      margin: '10px 0 0 0',
      fontSize: '11px',
      color: '#899c90',
      textAlign: 'center',
    });

    this.menuView.append(
      gameModeBox,
      aimModeBox,
      offlineBtn,
      createRoomBtn,
      joinForm,
      footerHint
    );

    // 2. Sub-view da Sala Privada (Lobby & Contagem)
    this.roomView = document.createElement('div');
    this.roomView.style.display = 'none';

    const codeBox = document.createElement('div');
    Object.assign(codeBox.style, {
      backgroundColor: '#18211c',
      border: '1px solid #324539',
      borderRadius: '8px',
      padding: '12px',
      textAlign: 'center',
      marginBottom: '12px',
    });

    const codeCaption = document.createElement('div');
    codeCaption.textContent = 'CÓDIGO DE CONVITE DA SALA';
    Object.assign(codeCaption.style, {
      fontSize: '11px',
      fontWeight: '700',
      color: '#8aa093',
      letterSpacing: '0.08em',
      marginBottom: '4px',
    });

    this.roomCodeDisplay = document.createElement('span');
    this.roomCodeDisplay.setAttribute('data-testid', 'lobby-room-code');
    this.roomCodeDisplay.textContent = '-----';
    Object.assign(this.roomCodeDisplay.style, {
      fontSize: '26px',
      fontFamily: 'monospace',
      fontWeight: '800',
      letterSpacing: '0.18em',
      color: '#63cf88',
      display: 'block',
      marginBottom: '8px',
    });

    const metaRow = document.createElement('div');
    Object.assign(metaRow.style, {
      display: 'flex',
      justifyContent: 'center',
      gap: '8px',
      flexWrap: 'wrap',
    });

    this.lobbyModeBadge = document.createElement('span');
    this.lobbyModeBadge.setAttribute('data-testid', 'lobby-game-mode');
    Object.assign(this.lobbyModeBadge.style, {
      fontSize: '11px',
      fontFamily: 'monospace',
      fontWeight: '700',
      padding: '3px 8px',
      borderRadius: '4px',
      backgroundColor: '#213829',
      border: '1px solid #498c61',
      color: '#9bf5b9',
    });

    this.lobbySeedBadge = document.createElement('span');
    this.lobbySeedBadge.setAttribute('data-testid', 'lobby-map-seed');
    Object.assign(this.lobbySeedBadge.style, {
      fontSize: '11px',
      fontFamily: 'monospace',
      fontWeight: '700',
      padding: '3px 8px',
      borderRadius: '4px',
      backgroundColor: '#1b262d',
      border: '1px solid #3c5d70',
      color: '#9fd7ff',
    });

    metaRow.append(this.lobbyModeBadge, this.lobbySeedBadge);
    codeBox.append(codeCaption, this.roomCodeDisplay, metaRow);

    this.phaseStatusText = document.createElement('p');
    this.phaseStatusText.setAttribute('data-testid', 'lobby-phase-status');
    this.phaseStatusText.textContent = 'Aguardando os 2 jogadores marcarem pronto...';
    Object.assign(this.phaseStatusText.style, {
      margin: '0 0 12px 0',
      fontSize: '13px',
      color: '#bfd1c6',
      textAlign: 'center',
      fontWeight: '600',
    });

    const slotsWrap = document.createElement('div');
    Object.assign(slotsWrap.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '10px',
      marginBottom: '14px',
    });

    this.slotBlueEl = this.createPlayerSlotCard('JOGADOR 1 (AZUL)', '#2b95ff');
    this.slotOrangeEl = this.createPlayerSlotCard('JOGADOR 2 (LARANJA)', '#ff7b29');
    slotsWrap.append(this.slotBlueEl, this.slotOrangeEl);

    const roomButtonsRow = document.createElement('div');
    Object.assign(roomButtonsRow.style, {
      display: 'flex',
      gap: '10px',
    });

    this.readyBtn = document.createElement('button');
    this.readyBtn.type = 'button';
    this.readyBtn.textContent = 'Marcar Pronto';
    this.readyBtn.setAttribute('data-testid', 'btn-toggle-ready');
    Object.assign(this.readyBtn.style, {
      flex: '1',
      padding: '11px 16px',
      fontSize: '14px',
      fontWeight: '700',
      backgroundColor: '#38b865',
      color: '#0c0f0d',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
    });
    this.readyBtn.addEventListener('click', () => {
      this.readyBtn.blur();
      this.actions.onToggleReady();
    });

    const leaveBtn = document.createElement('button');
    leaveBtn.type = 'button';
    leaveBtn.textContent = 'Sair';
    leaveBtn.setAttribute('data-testid', 'btn-leave-room');
    Object.assign(leaveBtn.style, {
      padding: '11px 16px',
      fontSize: '14px',
      fontWeight: '600',
      backgroundColor: '#26322b',
      color: '#d4e0d8',
      border: '1px solid #394b40',
      borderRadius: '6px',
      cursor: 'pointer',
    });
    leaveBtn.addEventListener('click', () => {
      leaveBtn.blur();
      void this.actions.onLeaveRoom();
    });

    roomButtonsRow.append(this.readyBtn, leaveBtn);
    this.roomView.append(codeBox, this.phaseStatusText, slotsWrap, roomButtonsRow);

    panel.append(header, this.errorBanner, this.menuView, this.roomView);
    this.root.appendChild(panel);
    document.body.appendChild(this.root);
  }

  setGameMode(mode: GameMode): void {
    this.currentGameMode = mode === 'exploration' ? 'exploration' : 'rounds';
    this.refreshGameModeStyles();
  }

  getGameMode(): GameMode {
    return this.currentGameMode;
  }

  setSeed(seed: number): void {
    if (Number.isInteger(seed) && seed > 0) {
      this.currentSeed = seed;
      this.seedInput.value = String(seed);
    }
  }

  getSeed(): number {
    return this.readValidatedSeed();
  }

  setAimMode(mode: AimMode): void {
    this.currentAimMode = mode;
    this.refreshAimModeStyles();
  }

  private readValidatedSeed(): number {
    const parsed = Number(this.seedInput.value);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 0x7fffffff) {
      this.currentSeed = parsed;
      return parsed;
    }
    return this.currentSeed || BALANCE.SIMULATION.DEFAULT_SEED;
  }

  private refreshGameModeStyles(): void {
    const isRounds = this.currentGameMode === 'rounds';
    Object.assign(this.modeRoundsBtn.style, {
      padding: '9px 10px',
      fontSize: '12px',
      fontWeight: '700',
      borderRadius: '6px',
      cursor: 'pointer',
      border: isRounds ? '1.5px solid #63cf88' : '1px solid #2e3d33',
      backgroundColor: isRounds ? '#1e3828' : '#111613',
      color: isRounds ? '#84f5a8' : '#95a89c',
    });
    Object.assign(this.modeExplorationBtn.style, {
      padding: '9px 10px',
      fontSize: '12px',
      fontWeight: '700',
      borderRadius: '6px',
      cursor: 'pointer',
      border: !isRounds ? '1.5px solid #52b0ff' : '1px solid #2e3d33',
      backgroundColor: !isRounds ? '#152c3f' : '#111613',
      color: !isRounds ? '#94d0ff' : '#95a89c',
    });
    this.modeRoundsBtn.setAttribute('aria-pressed', String(isRounds));
    this.modeExplorationBtn.setAttribute('aria-pressed', String(!isRounds));

    this.modeSummaryText.textContent = isRounds
      ? 'Modo 1: Rodadas numeradas finitas, 25s de preparação entre ondas (com opção de antecipar) e inimigo de Elite a cada 5 rodadas.'
      : 'Modo 2: Mundo aberto com grupos espalhados, exploração por setores e grandes hordas periódicas com aviso prévio de 60s.';
  }

  private refreshAimModeStyles(): void {
    const isAuto = this.currentAimMode === 'auto';
    Object.assign(this.aimAutoBtn.style, {
      padding: '8px 10px',
      fontSize: '12px',
      fontWeight: '700',
      borderRadius: '6px',
      cursor: 'pointer',
      border: isAuto ? '1px solid #63cf88' : '1px solid #2e3d33',
      backgroundColor: isAuto ? '#203b2a' : '#111613',
      color: isAuto ? '#7ef0a3' : '#95a89c',
    });
    Object.assign(this.aimManualBtn.style, {
      padding: '8px 10px',
      fontSize: '12px',
      fontWeight: '700',
      borderRadius: '6px',
      cursor: 'pointer',
      border: !isAuto ? '1px solid #ff9a47' : '1px solid #2e3d33',
      backgroundColor: !isAuto ? '#3b2414' : '#111613',
      color: !isAuto ? '#ffbe85' : '#95a89c',
    });
    this.aimAutoBtn.setAttribute('aria-pressed', String(isAuto));
    this.aimManualBtn.setAttribute('aria-pressed', String(!isAuto));
  }

  showMenu(errorMessage?: string): void {
    this.visible = true;
    this.root.style.display = 'flex';
    this.menuView.style.display = 'block';
    this.roomView.style.display = 'none';
    if (errorMessage) {
      this.showError(errorMessage);
    }
    document.body.dataset.state = 'title';
  }

  showRoomLobby(
    roomCode: string,
    phase: RoomPhase,
    countdownMs: number,
    players: PlayerStateSnapshot[],
    localPlayerId: string,
    gameMode: GameMode = 'rounds',
    seed: number = BALANCE.SIMULATION.DEFAULT_SEED
  ): void {
    if (phase === 'playing' || phase === 'gameover') {
      this.hide();
      return;
    }

    this.visible = true;
    this.root.style.display = 'flex';
    this.menuView.style.display = 'none';
    this.roomView.style.display = 'block';
    this.roomCodeDisplay.textContent = roomCode || '-----';
    this.lobbyModeBadge.textContent =
      gameMode === 'exploration'
        ? 'MODO: EXPLORAÇÃO E ABRIGO'
        : 'MODO: SOBREVIVÊNCIA POR RODADAS';
    this.lobbySeedBadge.textContent = `SEED: ${seed}`;

    const pBlue = players.find((p) => p.colorIndex === 0);
    const pOrange = players.find((p) => p.colorIndex === 1);

    this.updateSlotCard(this.slotBlueEl, 'JOGADOR 1 (AZUL)', pBlue, localPlayerId);
    this.updateSlotCard(this.slotOrangeEl, 'JOGADOR 2 (LARANJA)', pOrange, localPlayerId);

    const localPlayer = players.find((p) => p.id === localPlayerId);
    if (localPlayer?.ready) {
      this.readyBtn.textContent = 'Cancelar Pronto';
      this.readyBtn.style.backgroundColor = '#e08a44';
    } else {
      this.readyBtn.textContent = 'Marcar Pronto';
      this.readyBtn.style.backgroundColor = '#38b865';
    }

    if (phase === 'countdown') {
      const secs = Math.max(1, Math.ceil(countdownMs / 1000));
      this.phaseStatusText.textContent = `CONTAGEM REGRESSIVA: Iniciando em ${secs}s...`;
      this.phaseStatusText.style.color = '#63cf88';
    } else if (players.length < 2) {
      this.phaseStatusText.textContent =
        'Compartilhe o código de 5 caracteres com o 2º jogador.';
      this.phaseStatusText.style.color = '#bfd1c6';
    } else {
      this.phaseStatusText.textContent =
        '2/2 na sala! A partida começa quando os dois marcarem pronto.';
      this.phaseStatusText.style.color = '#ffe066';
    }

    document.body.dataset.state = 'lobby';
    document.body.dataset.roomCode = roomCode;
    document.body.dataset.roomPhase = phase;
    document.body.dataset.gameMode = gameMode;
    document.body.dataset.seed = String(seed);
  }

  showError(message: string): void {
    this.errorBanner.textContent = message;
    this.errorBanner.style.display = 'block';
  }

  clearError(): void {
    this.errorBanner.textContent = '';
    this.errorBanner.style.display = 'none';
  }

  hide(): void {
    if (!this.visible) {
      return;
    }
    this.visible = false;
    this.root.style.display = 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.root.remove();
  }

  private createPlayerSlotCard(title: string, accentColor: string): HTMLDivElement {
    const box = document.createElement('div');
    Object.assign(box.style, {
      backgroundColor: '#18201b',
      border: `1px solid ${accentColor}`,
      borderRadius: '6px',
      padding: '10px',
      textAlign: 'center',
    });
    box.innerHTML = `
      <div style="font-size:11px;font-weight:800;color:${accentColor};margin-bottom:4px;">${title}</div>
      <div class="slot-status" style="font-size:12px;color:#9fb0a5;font-weight:600;">Aguardando...</div>
    `;
    return box;
  }

  private updateSlotCard(
    box: HTMLDivElement,
    _title: string,
    player: PlayerStateSnapshot | undefined,
    localPlayerId: string
  ): void {
    const statusEl = box.querySelector('.slot-status') as HTMLDivElement | null;
    if (!statusEl) {
      return;
    }
    if (!player) {
      statusEl.textContent = 'Aguardando...';
      statusEl.style.color = '#7b8c81';
      return;
    }
    const youTag = player.id === localPlayerId ? ' (Você)' : '';
    if (player.ready) {
      statusEl.textContent = `PRONTO${youTag}`;
      statusEl.style.color = '#63cf88';
    } else {
      statusEl.textContent = `Não pronto${youTag}`;
      statusEl.style.color = '#e6ece8';
    }
  }
}
