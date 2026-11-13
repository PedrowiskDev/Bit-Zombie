import { normalizeInputVector, type Vec2 } from '@zombie-coop/shared';

/**
 * Controlador de teclado para WASD e Setas direcionais.
 * Limpa automaticamente teclas pressionadas quando a janela perde foco (`blur`)
 * ou a aba fica oculta (`visibilitychange`).
 */
export class KeyboardController {
  private readonly pressedCodes = new Set<string>();
  private readonly onKeyDownBound: (ev: KeyboardEvent) => void;
  private readonly onKeyUpBound: (ev: KeyboardEvent) => void;
  private readonly onBlurBound: () => void;
  private readonly onVisibilityBound: () => void;

  constructor() {
    this.onKeyDownBound = (ev: KeyboardEvent) => this.handleKeyDown(ev);
    this.onKeyUpBound = (ev: KeyboardEvent) => this.handleKeyUp(ev);
    this.onBlurBound = () => this.clear();
    this.onVisibilityBound = () => {
      if (document.visibilityState !== 'visible') {
        this.clear();
      }
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
    document.addEventListener('visibilitychange', this.onVisibilityBound);
  }

  getVector(): Vec2 {
    let dx = 0;
    let dy = 0;

    if (this.pressedCodes.has('KeyA') || this.pressedCodes.has('ArrowLeft')) {
      dx -= 1;
    }
    if (this.pressedCodes.has('KeyD') || this.pressedCodes.has('ArrowRight')) {
      dx += 1;
    }
    if (this.pressedCodes.has('KeyW') || this.pressedCodes.has('ArrowUp')) {
      dy -= 1;
    }
    if (this.pressedCodes.has('KeyS') || this.pressedCodes.has('ArrowDown')) {
      dy += 1;
    }

    return normalizeInputVector(dx, dy);
  }

  clear(): void {
    this.pressedCodes.clear();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('blur', this.onBlurBound);
    document.removeEventListener('visibilitychange', this.onVisibilityBound);
    this.pressedCodes.clear();
  }

  private handleKeyDown(ev: KeyboardEvent): void {
    if (this.isMovementKey(ev.code)) {
      ev.preventDefault();
      this.pressedCodes.add(ev.code);
    }
  }

  private handleKeyUp(ev: KeyboardEvent): void {
    if (this.isMovementKey(ev.code)) {
      ev.preventDefault();
      this.pressedCodes.delete(ev.code);
    }
  }

  private isMovementKey(code: string): boolean {
    return (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'ArrowUp' ||
      code === 'ArrowLeft' ||
      code === 'ArrowDown' ||
      code === 'ArrowRight'
    );
  }
}
