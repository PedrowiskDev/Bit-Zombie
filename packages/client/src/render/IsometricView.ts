import { BALANCE } from '@zombie-coop/shared';
import { GroundProjection, type Point } from './GroundProjection.js';

const YAW = Math.PI / 4;
const ELEVATION = Math.atan(1 / Math.SQRT2);
const ZOOM_LEVELS = [1, 1.15, 1.3] as const;
const MAX_GROUND_RADIUS = BALANCE.SPAWN.RING_MIN_RADIUS - 90;
const MAX_FOLLOW_LAG = 48;

export class IsometricView {
  private center?: Point;
  private zoomIndex = 0;

  get zoom(): number {
    return ZOOM_LEVELS[this.zoomIndex];
  }

  changeZoom(direction?: -1 | 1): void {
    this.zoomIndex = direction === undefined
      ? (this.zoomIndex + 1) % ZOOM_LEVELS.length
      : Math.max(0, Math.min(ZOOM_LEVELS.length - 1, this.zoomIndex + direction));
  }

  resetFollow(): void {
    this.center = undefined;
  }

  update(target: Point, width: number, height: number, deltaMs: number): GroundProjection {
    const center = this.center ?? { ...target };
    const follow = 1 - Math.exp(-10 * Math.min(100, Math.max(0, deltaMs)) / 1000);
    center.x += (target.x - center.x) * follow;
    center.y += (target.y - center.y) * follow;
    const dx = center.x - target.x;
    const dy = center.y - target.y;
    const lag = Math.hypot(dx, dy);
    if (lag > MAX_FOLLOW_LAG) {
      center.x = target.x + dx * MAX_FOLLOW_LAG / lag;
      center.y = target.y + dy * MAX_FOLLOW_LAG / lag;
    }
    this.center = center;

    const radius = Math.hypot(width / 2, height / (2 * Math.sin(ELEVATION)));
    const scale = Math.min(1, MAX_GROUND_RADIUS / radius) / this.zoom;
    const viewWidth = width * scale;
    const viewHeight = height * scale;
    return new GroundProjection({
      x: center.x - viewWidth / 2, y: center.y - viewHeight / 2,
      width: viewWidth, height: viewHeight,
    }, YAW, ELEVATION);
  }
}
