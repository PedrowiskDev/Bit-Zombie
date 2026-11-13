import { normalizeInputVector, type Vec2 } from '@zombie-coop/shared';

export interface JoystickVisualState {
  active: boolean;
  baseX: number;
  baseY: number;
  knobX: number;
  knobY: number;
  maxRadius: number;
  vector: Vec2;
}

export interface RightAimStickState {
  active: boolean;
  hasAimed: boolean;
  firing: boolean;
  aimX: number;
  aimY: number;
}

/**
 * Controlador de entrada multiplataforma para Etapa 2 (PC Mouse + Celular Twin-Stick):
 * - Celular (Touch):
 *   - Metade esquerda da tela (`x <= logicalWidth * 0.5`): Joystick de Movimento.
 *   - Metade direita da tela (`x > logicalWidth * 0.5`): Joystick de Mira Direcional (orienta o cone de visão).
 *   - Ao soltar o joystick direito, mantém a última direção olhada (`rightAimVector` preservado).
 *   - Olhar ao redor com o joystick direito NÃO dispara sozinho (evita gastar munição apenas girando a visão).
 *   - O ataque manual no celular é acionado pelo botão dedicado de Ataque (`setAttackButtonHeld`).
 * - PC (Mouse):
 *   - O cursor do mouse orienta continuamente a direção da visão.
 *   - O clique esquerdo do mouse (`button === 0`) executa o ataque (`mouseAttackHeld`).
 */
export class VirtualJoystick {
  private readonly targetElement: HTMLElement;
  private readonly maxRadiusLogical = 52;
  private readonly deadZoneRatio = 0.08;

  private logicalWidth: number;
  private logicalHeight: number;

  // Estado do Joystick Esquerdo (Movimento)
  private leftPointerId: number | null = null;
  private leftBaseX = 136;
  private leftBaseY = 420;
  private leftKnobX = 136;
  private leftKnobY = 420;
  private leftVector: Vec2 = { x: 0, y: 0 };

  // Estado do Joystick Direito (Mira Direcional no lado direito da tela)
  private rightPointerId: number | null = null;
  private rightBaseX = 824;
  private rightBaseY = 420;
  private rightKnobX = 824;
  private rightKnobY = 420;
  private rightAimVector: Vec2 = { x: 1, y: 0 };
  private hasRightAimed = false;

  // Estado do Mouse (PC) e Botão de Ataque Dedicado (Mobile/HUD)
  private mouseLogicalPos: Vec2 | null = null;
  private mouseAttackHeld = false;
  private attackButtonHeld = false;

  private readonly onPointerDownBound: (ev: PointerEvent) => void;
  private readonly onPointerMoveBound: (ev: PointerEvent) => void;
  private readonly onPointerUpBound: (ev: PointerEvent) => void;
  private readonly onTouchNonPassiveBound: (ev: TouchEvent) => void;
  private readonly onBlurBound: () => void;

  constructor(
    targetElement: HTMLElement,
    logicalWidth = 960,
    logicalHeight = 540
  ) {
    this.targetElement = targetElement;
    this.targetElement.style.touchAction = 'none';
    this.logicalWidth = logicalWidth;
    this.logicalHeight = logicalHeight;
    this.recomputeRestPositions();

    this.onPointerDownBound = (ev: PointerEvent) => this.handlePointerDown(ev);
    this.onPointerMoveBound = (ev: PointerEvent) => this.handlePointerMove(ev);
    this.onPointerUpBound = (ev: PointerEvent) => this.handlePointerUpOrCancel(ev);
    this.onTouchNonPassiveBound = (ev: TouchEvent) => {
      if (
        this.leftPointerId !== null ||
        this.rightPointerId !== null ||
        ev.target === this.targetElement
      ) {
        ev.preventDefault();
      }
    };
    this.onBlurBound = () => this.reset();

    this.targetElement.addEventListener('pointerdown', this.onPointerDownBound, {
      passive: false,
    });
    window.addEventListener('pointermove', this.onPointerMoveBound, { passive: false });
    window.addEventListener('pointerup', this.onPointerUpBound, { passive: false });
    window.addEventListener('pointercancel', this.onPointerUpBound, { passive: false });
    window.addEventListener('lostpointercapture', this.onPointerUpBound, {
      passive: false,
    });
    this.targetElement.addEventListener('touchstart', this.onTouchNonPassiveBound, {
      passive: false,
    });
    this.targetElement.addEventListener('touchmove', this.onTouchNonPassiveBound, {
      passive: false,
    });
    window.addEventListener('blur', this.onBlurBound);
  }

  /**
   * Atualiza as dimensões lógicas da tela (ex.: rotação entre Portrait 540x960 e Landscape 960x540).
   */
  setLogicalViewport(width: number, height: number): void {
    if (this.logicalWidth === width && this.logicalHeight === height) {
      return;
    }
    this.logicalWidth = width;
    this.logicalHeight = height;
    this.recomputeRestPositions();
  }

  getVector(): Vec2 {
    return this.leftVector;
  }

  getVisualState(): JoystickVisualState {
    return {
      active: this.leftPointerId !== null,
      baseX: this.leftBaseX,
      baseY: this.leftBaseY,
      knobX: this.leftKnobX,
      knobY: this.leftKnobY,
      maxRadius: this.maxRadiusLogical,
      vector: this.leftVector,
    };
  }

  getRightAimState(): RightAimStickState {
    const active = this.rightPointerId !== null;
    return {
      active,
      hasAimed: this.hasRightAimed,
      firing: this.attackButtonHeld || this.mouseAttackHeld,
      aimX: this.rightAimVector.x,
      aimY: this.rightAimVector.y,
    };
  }

  getRightVisualState(): JoystickVisualState {
    return {
      active: this.rightPointerId !== null,
      baseX: this.rightBaseX,
      baseY: this.rightBaseY,
      knobX: this.rightKnobX,
      knobY: this.rightKnobY,
      maxRadius: this.maxRadiusLogical,
      vector: this.rightAimVector,
    };
  }

  getMouseLogicalPosition(): Vec2 | null {
    return this.mouseLogicalPos;
  }

  isAttackHeld(): boolean {
    return this.attackButtonHeld || this.mouseAttackHeld;
  }

  setAttackButtonHeld(held: boolean): void {
    this.attackButtonHeld = held;
  }

  /**
   * Permite definir ou atualizar a direção da mira (mantendo a última direção ao soltar).
   */
  setAimDirection(aimX: number, aimY: number): void {
    const norm = normalizeInputVector(aimX, aimY);
    if (norm.x !== 0 || norm.y !== 0) {
      this.rightAimVector = norm;
      this.hasRightAimed = true;
      this.mouseLogicalPos = null;
    }
  }

  reset(): void {
    this.resetLeft();
    this.resetRight();
    this.mouseAttackHeld = false;
    this.attackButtonHeld = false;
  }

  private defaultRestCoords(): {
    leftX: number;
    leftY: number;
    rightX: number;
    rightY: number;
  } {
    const isPortrait = this.logicalHeight > this.logicalWidth;
    const padX = Math.round(Math.min(136, Math.max(88, this.logicalWidth * 0.22)));
    const restY = isPortrait ? this.logicalHeight - 175 : this.logicalHeight - 135;
    return {
      leftX: padX,
      leftY: restY,
      rightX: this.logicalWidth - padX,
      rightY: restY,
    };
  }

  private recomputeRestPositions(): void {
    const coords = this.defaultRestCoords();
    if (this.leftPointerId === null) {
      this.leftBaseX = coords.leftX;
      this.leftBaseY = coords.leftY;
      this.leftKnobX = coords.leftX;
      this.leftKnobY = coords.leftY;
    }
    if (this.rightPointerId === null) {
      this.rightBaseX = coords.rightX;
      this.rightBaseY = coords.rightY;
      this.rightKnobX = coords.rightX;
      this.rightKnobY = coords.rightY;
    }
  }

  private resetLeft(): void {
    const coords = this.defaultRestCoords();
    this.leftPointerId = null;
    this.leftBaseX = coords.leftX;
    this.leftBaseY = coords.leftY;
    this.leftKnobX = coords.leftX;
    this.leftKnobY = coords.leftY;
    this.leftVector = { x: 0, y: 0 };
  }

  private resetRight(): void {
    const coords = this.defaultRestCoords();
    this.rightPointerId = null;
    this.rightBaseX = coords.rightX;
    this.rightBaseY = coords.rightY;
    this.rightKnobX = coords.rightX;
    this.rightKnobY = coords.rightY;
    // Importante (Etapa 2): this.rightAimVector NÃO é zerado ao soltar a mira,
    // preservando a última direção olhada pelo jogador.
  }

  destroy(): void {
    this.targetElement.removeEventListener('pointerdown', this.onPointerDownBound);
    window.removeEventListener('pointermove', this.onPointerMoveBound);
    window.removeEventListener('pointerup', this.onPointerUpBound);
    window.removeEventListener('pointercancel', this.onPointerUpBound);
    window.removeEventListener('lostpointercapture', this.onPointerUpBound);
    this.targetElement.removeEventListener('touchstart', this.onTouchNonPassiveBound);
    this.targetElement.removeEventListener('touchmove', this.onTouchNonPassiveBound);
    window.removeEventListener('blur', this.onBlurBound);
    this.reset();
  }

  private handlePointerDown(ev: PointerEvent): void {
    const pos = this.clientToLogical(ev.clientX, ev.clientY);
    if (!pos) {
      return;
    }

    // No PC (mouse): clique esquerdo executa o ataque e atualiza a posição da mira
    if (ev.pointerType === 'mouse') {
      this.mouseLogicalPos = pos;
      if (ev.button === 0) {
        this.mouseAttackHeld = true;
      }
      return;
    }

    // Metade esquerda da tela (Touch): Joystick de Movimento
    if (pos.x <= this.logicalWidth * 0.5) {
      if (this.leftPointerId !== null) {
        return;
      }
      ev.preventDefault();
      this.leftPointerId = ev.pointerId;
      this.leftBaseX = pos.x;
      this.leftBaseY = pos.y;
      this.leftKnobX = pos.x;
      this.leftKnobY = pos.y;
      this.leftVector = { x: 0, y: 0 };
      this.trySetPointerCapture(ev.pointerId);
      return;
    }

    // Metade direita da tela (Touch): Joystick de Mira Direcional (orienta visão sem disparar sozinho)
    if (this.rightPointerId !== null) {
      return;
    }
    ev.preventDefault();
    this.mouseLogicalPos = null;
    this.rightPointerId = ev.pointerId;
    this.rightBaseX = pos.x;
    this.rightBaseY = pos.y;
    this.rightKnobX = pos.x;
    this.rightKnobY = pos.y;
    this.trySetPointerCapture(ev.pointerId);
  }

  private handlePointerMove(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse' && this.leftPointerId === null && this.rightPointerId === null) {
      const pos = this.clientToLogical(ev.clientX, ev.clientY);
      if (pos) {
        this.mouseLogicalPos = pos;
      }
      return;
    }

    if (this.leftPointerId !== null && ev.pointerId === this.leftPointerId) {
      ev.preventDefault();
      const pos = this.clientToLogical(ev.clientX, ev.clientY);
      if (!pos) {
        return;
      }

      const rawDx = pos.x - this.leftBaseX;
      const rawDy = pos.y - this.leftBaseY;
      const dist = Math.hypot(rawDx, rawDy);

      if (dist <= this.maxRadiusLogical * this.deadZoneRatio) {
        this.leftKnobX = this.leftBaseX;
        this.leftKnobY = this.leftBaseY;
        this.leftVector = { x: 0, y: 0 };
        return;
      }

      const clampedDist = Math.min(dist, this.maxRadiusLogical);
      const angle = Math.atan2(rawDy, rawDx);
      this.leftKnobX = this.leftBaseX + Math.cos(angle) * clampedDist;
      this.leftKnobY = this.leftBaseY + Math.sin(angle) * clampedDist;

      const normX = (Math.cos(angle) * clampedDist) / this.maxRadiusLogical;
      const normY = (Math.sin(angle) * clampedDist) / this.maxRadiusLogical;
      this.leftVector = normalizeInputVector(normX, normY);
      return;
    }

    if (this.rightPointerId !== null && ev.pointerId === this.rightPointerId) {
      ev.preventDefault();
      const pos = this.clientToLogical(ev.clientX, ev.clientY);
      if (!pos) {
        return;
      }

      const rawDx = pos.x - this.rightBaseX;
      const rawDy = pos.y - this.rightBaseY;
      const dist = Math.hypot(rawDx, rawDy);

      if (dist <= this.maxRadiusLogical * this.deadZoneRatio) {
        this.rightKnobX = this.rightBaseX;
        this.rightKnobY = this.rightBaseY;
        return;
      }

      const clampedDist = Math.min(dist, this.maxRadiusLogical);
      const angle = Math.atan2(rawDy, rawDx);
      this.rightKnobX = this.rightBaseX + Math.cos(angle) * clampedDist;
      this.rightKnobY = this.rightBaseY + Math.sin(angle) * clampedDist;
      this.rightAimVector = {
        x: Math.cos(angle),
        y: Math.sin(angle),
      };
      this.hasRightAimed = true;
    }
  }

  private handlePointerUpOrCancel(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse' && ev.button === 0) {
      this.mouseAttackHeld = false;
    }
    if (this.leftPointerId !== null && ev.pointerId === this.leftPointerId) {
      ev.preventDefault();
      this.resetLeft();
    }
    if (this.rightPointerId !== null && ev.pointerId === this.rightPointerId) {
      ev.preventDefault();
      this.resetRight();
    }
  }

  private trySetPointerCapture(pointerId: number): void {
    try {
      this.targetElement.setPointerCapture(pointerId);
    } catch {
      // Ignora em navegadores sintéticos que não suportam pointer capture
    }
  }

  private clientToLogical(clientX: number, clientY: number): Vec2 | null {
    const canvas = this.targetElement.querySelector('canvas') ?? this.targetElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const x = ((clientX - rect.left) / rect.width) * this.logicalWidth;
    const y = ((clientY - rect.top) / rect.height) * this.logicalHeight;
    return { x, y };
  }
}
