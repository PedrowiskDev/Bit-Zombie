import {
  UPGRADE_CATALOG,
  isValidUpgradeId,
  type UpgradeCategory,
  type UpgradeId,
} from '@zombie-coop/shared';

export class UpgradePickerOverlay {
  private readonly rootEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly cardsRowEl: HTMLDivElement;
  private readonly onSelectUpgrade: (upgradeId: UpgradeId) => void;
  private readonly onKeyDownBound: (ev: KeyboardEvent) => void;

  private currentOptionsKey = '';
  private currentOptions: UpgradeId[] = [];
  private visible = false;

  constructor(onSelectUpgrade: (upgradeId: UpgradeId) => void) {
    this.onSelectUpgrade = onSelectUpgrade;

    this.rootEl = document.createElement('div');
    this.rootEl.setAttribute('data-testid', 'upgrade-picker-overlay');
    Object.assign(this.rootEl.style, {
      position: 'fixed',
      top: 'calc(122px + var(--safe-top))',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(94vw, 560px)',
      display: 'none',
      flexDirection: 'column',
      gap: '6px',
      padding: '8px 10px',
      backgroundColor: 'rgba(13, 20, 16, 0.94)',
      border: '1.5px solid #48b872',
      borderRadius: '10px',
      boxShadow: '0 10px 28px rgba(0, 0, 0, 0.68)',
      zIndex: '35',
      pointerEvents: 'none',
      fontFamily: 'monospace',
    });

    this.titleEl = document.createElement('div');
    this.titleEl.setAttribute('data-testid', 'upgrade-picker-title');
    Object.assign(this.titleEl.style, {
      fontSize: '11px',
      fontWeight: '800',
      color: '#9ef5bc',
      textAlign: 'center',
      letterSpacing: '0.03em',
    });

    this.cardsRowEl = document.createElement('div');
    Object.assign(this.cardsRowEl.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: '6px',
      pointerEvents: 'auto',
    });

    this.rootEl.appendChild(this.titleEl);
    this.rootEl.appendChild(this.cardsRowEl);
    document.body.appendChild(this.rootEl);

    this.onKeyDownBound = (ev: KeyboardEvent) => {
      if (!this.visible || this.currentOptions.length === 0) {
        return;
      }
      if (ev.code === 'Digit1' || ev.code === 'Numpad1') {
        ev.preventDefault();
        if (this.currentOptions[0]) this.onSelectUpgrade(this.currentOptions[0]);
      } else if (ev.code === 'Digit2' || ev.code === 'Numpad2') {
        ev.preventDefault();
        if (this.currentOptions[1]) this.onSelectUpgrade(this.currentOptions[1]);
      } else if (ev.code === 'Digit3' || ev.code === 'Numpad3') {
        ev.preventDefault();
        if (this.currentOptions[2]) this.onSelectUpgrade(this.currentOptions[2]);
      }
    };
    window.addEventListener('keydown', this.onKeyDownBound);
  }

  update(rawOptions: readonly string[] | undefined, remainingMs = 0): void {
    const validOptions: UpgradeId[] = [];
    if (rawOptions) {
      for (const item of rawOptions) {
        if (isValidUpgradeId(item)) {
          validOptions.push(item);
        }
      }
    }

    if (validOptions.length === 0) {
      if (this.visible) {
        this.visible = false;
        this.currentOptionsKey = '';
        this.currentOptions = [];
        this.rootEl.style.display = 'none';
      }
      return;
    }

    const secLeft = Math.max(1, Math.ceil(remainingMs / 1000));
    this.titleEl.textContent = `SUBIU DE NÍVEL! ESCOLHA UM UPGRADE (1-3 OU TOQUE) · ${secLeft}s`;

    const nextKey = validOptions.join(',');
    if (!this.visible) {
      this.visible = true;
      this.rootEl.style.display = 'flex';
    }

    if (nextKey === this.currentOptionsKey) {
      return;
    }

    this.currentOptionsKey = nextKey;
    this.currentOptions = validOptions;
    this.renderCards(validOptions);
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    this.rootEl.remove();
  }

  private renderCards(options: readonly UpgradeId[]): void {
    this.cardsRowEl.innerHTML = '';

    options.forEach((upgradeId, idx) => {
      const def = UPGRADE_CATALOG[upgradeId];
      const palette = this.getCategoryPalette(def.category);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-testid', `upgrade-card-${idx}`);
      btn.setAttribute('data-upgrade-id', upgradeId);
      Object.assign(btn.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '4px',
        padding: '7px 8px',
        minHeight: '66px',
        backgroundColor: palette.bg,
        border: `1.5px solid ${palette.border}`,
        borderRadius: '7px',
        color: '#eef5f0',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'monospace',
      });

      const badgeEl = document.createElement('div');
      badgeEl.textContent = `[${idx + 1}] ${palette.label}`;
      Object.assign(badgeEl.style, {
        fontSize: '9px',
        fontWeight: '800',
        color: palette.accent,
      });

      const nameEl = document.createElement('div');
      nameEl.textContent = def.name;
      Object.assign(nameEl.style, {
        fontSize: '11px',
        fontWeight: '800',
        color: '#ffffff',
        lineHeight: '1.2',
      });

      const descEl = document.createElement('div');
      descEl.textContent = def.description;
      Object.assign(descEl.style, {
        fontSize: '10px',
        color: '#b9c9be',
        lineHeight: '1.2',
      });

      btn.appendChild(badgeEl);
      btn.appendChild(nameEl);
      btn.appendChild(descEl);

      btn.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
      });
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.onSelectUpgrade(upgradeId);
      });

      this.cardsRowEl.appendChild(btn);
    });
  }

  private getCategoryPalette(category: UpgradeCategory): {
    label: string;
    bg: string;
    border: string;
    accent: string;
  } {
    switch (category) {
      case 'survivability':
        return {
          label: 'DEFESA / CURA',
          bg: 'rgba(20, 46, 30, 0.95)',
          border: '#4cd47c',
          accent: '#85ffaf',
        };
      case 'mobility':
        return {
          label: 'MOBILIDADE',
          bg: 'rgba(18, 36, 54, 0.95)',
          border: '#4ca6ff',
          accent: '#91cbff',
        };
      case 'weapon':
      default:
        return {
          label: 'ARMA / COMBATE',
          bg: 'rgba(52, 30, 16, 0.95)',
          border: '#ff9442',
          accent: '#ffc38a',
        };
    }
  }
}
