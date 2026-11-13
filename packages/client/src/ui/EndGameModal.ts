import type { GameMode } from '@zombie-coop/shared';

export interface EndGameStats {
  gameMode: GameMode;
  elapsedMs: number;
  level: number;
  kills: number;
  roundsCompleted?: number;
  totalRevives?: number;
  totalDamageDealt?: number;
  daysSurvived?: number;
  hordesCleared?: number;
  sectorsExplored?: number;
  structuresBuilt?: number;
}

/**
 * Modal de Fim de Jogo (Etapa 1 do Novo Plano + Etapa 3).
 * Exibe métricas específicas de cada modo:
 * - Modo 1 (Rodadas): Rodadas Concluídas, Tempo, Abates, Resgates, Dano Causado e Nível.
 * - Modo 2 (Exploração): Dias Sobrevividos, Hordas Vencidas, Setores Explorados, Construções, Abates e Tempo.
 */
export class EndGameModal {
  private readonly container: HTMLDivElement;
  private readonly modeBadgeEl: HTMLDivElement;
  private readonly statsGridEl: HTMLDivElement;
  private readonly playAgainBtn: HTMLButtonElement;
  private readonly onKeyDownBound: (ev: KeyboardEvent) => void;
  private visible = false;

  constructor(private readonly onPlayAgain: () => void) {
    this.container = document.createElement('div');
    this.container.id = 'end-game-modal';
    this.container.setAttribute('role', 'dialog');
    this.container.setAttribute('aria-modal', 'true');
    this.container.setAttribute('aria-labelledby', 'end-game-title');

    Object.assign(this.container.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(8, 11, 9, 0.84)',
      zIndex: '50',
      pointerEvents: 'auto',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      width: 'min(92vw, 440px)',
      backgroundColor: '#121814',
      border: '2px solid #8f2d38',
      borderRadius: '10px',
      padding: '24px 22px',
      boxShadow: '0 20px 50px rgba(0, 0, 0, 0.75)',
      textAlign: 'center',
      color: '#e6ece8',
    });

    const title = document.createElement('h2');
    title.id = 'end-game-title';
    title.textContent = 'FIM DE JOGO';
    Object.assign(title.style, {
      margin: '0 0 6px 0',
      fontSize: '26px',
      fontWeight: '800',
      letterSpacing: '0.06em',
      color: '#ff5c5c',
    });

    this.modeBadgeEl = document.createElement('div');
    this.modeBadgeEl.setAttribute('data-testid', 'endgame-mode-badge');
    Object.assign(this.modeBadgeEl.style, {
      fontSize: '11px',
      fontFamily: 'monospace',
      fontWeight: '700',
      color: '#84f5a8',
      marginBottom: '6px',
      letterSpacing: '0.06em',
    });

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Os sobreviventes tombaram perante a horda.';
    Object.assign(subtitle.style, {
      margin: '0 0 18px 0',
      fontSize: '13px',
      color: '#9fb0a5',
    });

    this.statsGridEl = document.createElement('div');
    Object.assign(this.statsGridEl.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '8px',
      marginBottom: '20px',
    });

    this.playAgainBtn = document.createElement('button');
    this.playAgainBtn.type = 'button';
    this.playAgainBtn.textContent = 'Jogar de Novo';
    this.playAgainBtn.setAttribute('data-start', 'true');
    this.playAgainBtn.setAttribute('data-testid', 'play-again-btn');
    Object.assign(this.playAgainBtn.style, {
      width: '100%',
      padding: '12px 20px',
      fontSize: '16px',
      fontWeight: '700',
      color: '#0c0f0d',
      backgroundColor: '#47b86e',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      letterSpacing: '0.02em',
    });

    this.playAgainBtn.addEventListener('click', () => {
      this.playAgainBtn.blur();
      this.triggerRestart();
    });

    card.append(title, this.modeBadgeEl, subtitle, this.statsGridEl, this.playAgainBtn);
    this.container.appendChild(card);
    document.body.appendChild(this.container);

    this.onKeyDownBound = (ev: KeyboardEvent) => {
      if (!this.visible) {
        return;
      }
      if (ev.code === 'Enter' || ev.code === 'Space') {
        ev.preventDefault();
        this.triggerRestart();
      }
    };
    window.addEventListener('keydown', this.onKeyDownBound);
  }

  show(stats: EndGameStats): void {
    if (this.visible) {
      return;
    }
    this.visible = true;
    this.statsGridEl.innerHTML = '';

    if (stats.gameMode === 'exploration') {
      this.modeBadgeEl.textContent = 'MODO 2 · EXPLORAÇÃO E ABRIGO';
      const tiles = [
        this.createStatTile('DIAS', String(stats.daysSurvived ?? 1)),
        this.createStatTile('HORDAS', String(stats.hordesCleared ?? 0)),
        this.createStatTile('SETORES', String(stats.sectorsExplored ?? 1)),
        this.createStatTile('CONSTRUÇÕES', String(stats.structuresBuilt ?? 0)),
        this.createStatTile('ABATES', String(stats.kills)),
        this.createStatTile('TEMPO', formatSurvivalTime(stats.elapsedMs)),
      ];
      for (const t of tiles) {
        this.statsGridEl.appendChild(t.root);
      }
    } else {
      this.modeBadgeEl.textContent = 'MODO 1 · SOBREVIVÊNCIA POR RODADAS';
      const tiles = [
        this.createStatTile('RODADAS', String(stats.roundsCompleted ?? 0)),
        this.createStatTile('TEMPO', formatSurvivalTime(stats.elapsedMs)),
        this.createStatTile('ABATES', String(stats.kills)),
        this.createStatTile('RESGATES', String(stats.totalRevives ?? 0)),
        this.createStatTile('DANO', String(Math.round(stats.totalDamageDealt ?? 0))),
        this.createStatTile('NÍVEL', String(stats.level)),
      ];
      for (const t of tiles) {
        this.statsGridEl.appendChild(t.root);
      }
    }

    this.container.style.display = 'flex';
    document.body.dataset.state = 'gameover';
  }

  hide(): void {
    if (!this.visible) {
      return;
    }
    this.visible = false;
    this.container.style.display = 'none';
    document.body.dataset.state = 'playing';
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    this.container.remove();
  }

  private triggerRestart(): void {
    if (!this.visible) {
      return;
    }
    this.hide();
    this.onPlayAgain();
  }

  private createStatTile(
    label: string,
    initialValue: string
  ): { root: HTMLDivElement; valueEl: HTMLSpanElement } {
    const root = document.createElement('div');
    Object.assign(root.style, {
      backgroundColor: '#19211c',
      border: '1px solid #2b3830',
      borderRadius: '6px',
      padding: '9px 6px',
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
    });

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    Object.assign(labelEl.style, {
      fontSize: '10px',
      fontWeight: '700',
      color: '#8aa093',
      letterSpacing: '0.05em',
    });

    const valueEl = document.createElement('span');
    valueEl.textContent = initialValue;
    Object.assign(valueEl.style, {
      fontSize: '18px',
      fontWeight: '800',
      color: '#ffffff',
      fontVariantNumeric: 'tabular-nums',
    });

    root.append(labelEl, valueEl);
    return { root, valueEl };
  }
}

export function formatSurvivalTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
