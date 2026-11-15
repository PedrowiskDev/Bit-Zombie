export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Affine projection of the ground plane. Screen units follow the supplied viewport. */
export class GroundProjection {
  constructor(
    readonly ground: Viewport,
    readonly yaw = 0,
    readonly elevation = Math.PI / 2,
  ) {}

  private readonly sinYaw = Math.sin(this.yaw);
  private readonly cosYaw = Math.cos(this.yaw);
  private readonly tilt = Math.sin(this.elevation);

  get center(): Point {
    return { x: this.ground.x + this.ground.width / 2, y: this.ground.y + this.ground.height / 2 };
  }

  worldToScreen(point: Point, screen: Viewport): Point {
    const center = this.center;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: screen.x + (0.5 + (dx * this.cosYaw + dy * this.sinYaw) / this.ground.width) * screen.width,
      y: screen.y + (0.5 + (-dx * this.sinYaw + dy * this.cosYaw) * this.tilt / this.ground.height) * screen.height,
    };
  }

  screenToGround(point: Point, screen: Viewport): Point {
    const center = this.center;
    const across = ((point.x - screen.x) / screen.width - 0.5) * this.ground.width;
    const down = ((point.y - screen.y) / screen.height - 0.5) * this.ground.height / this.tilt;
    return {
      x: center.x + across * this.cosYaw - down * this.sinYaw,
      y: center.y + across * this.sinYaw + down * this.cosYaw,
    };
  }

  /** Preserve analog stick strength while compensating for ground foreshortening. */
  inputToGround(input: Point): Point {
    const strength = Math.min(Math.hypot(input.x, input.y), 1);
    if (strength === 0) return { x: 0, y: 0 };
    const down = input.y / this.tilt;
    const scale = strength / Math.hypot(input.x, down);
    return {
      x: (input.x * this.cosYaw - down * this.sinYaw) * scale,
      y: (input.x * this.sinYaw + down * this.cosYaw) * scale,
    };
  }

  /** World height is on Three's Y axis. The camera looks toward the ground center. */
  cameraOffset(distance: number): { x: number; y: number; z: number } {
    const horizontal = distance * Math.cos(this.elevation);
    return { x: -this.sinYaw * horizontal, y: distance * this.tilt, z: this.cosYaw * horizontal };
  }
}
