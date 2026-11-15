import { BALANCE, type PlayerStateSnapshot, type UrbanMap } from '@zombie-coop/shared';
import type { RenderWorldState } from '../network/WorldProvider.js';

const SIZE = 256;
const VIEW_SPAN = 1050;
const REFRESH_MS = 100;

export class Minimap {
  private readonly canvas = document.createElement('canvas');
  private readonly terrain = document.createElement('canvas');
  private readonly context = this.canvas.getContext('2d');
  private map: UrbanMap | undefined;
  private lastDraw = -Infinity;

  constructor(parent: HTMLElement) {
    this.canvas.className = 'game-minimap';
    this.canvas.dataset.testid = 'minimap';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Minimapa das áreas exploradas com sua direção e aliados próximos');
    this.canvas.width = this.canvas.height = SIZE;
    this.terrain.width = this.terrain.height = 512;
    this.canvas.hidden = true;
    parent.append(this.canvas);
  }

  hide(): void {
    this.canvas.hidden = true;
    this.lastDraw = -Infinity;
  }

  destroy(): void {
    this.canvas.remove();
  }

  update(world: RenderWorldState, map: UrbanMap, explored: HTMLCanvasElement, player: PlayerStateSnapshot): void {
    const ctx = this.context;
    if (!ctx) return;

    const now = performance.now();
    if (this.map !== map) {
      this.drawTerrain(world, map);
      this.map = map;
      this.lastDraw = -Infinity;
    }
    if (now - this.lastDraw < REFRESH_MS) return;
    this.lastDraw = now;
    this.canvas.hidden = false;

    const scale = SIZE / VIEW_SPAN;
    const left = SIZE / 2 - player.x * scale;
    const top = SIZE / 2 - player.y * scale;
    const width = world.mapWidth * scale;
    const height = world.mapHeight * scale;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.terrain, left, top, width, height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(explored, left, top, width, height);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#131814';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalCompositeOperation = 'source-over';

    for (const ally of world.players) {
      if (ally.id === player.id || !ally.connected) continue;
      const x = left + ally.x * scale;
      const y = top + ally.y * scale;
      if (x < 8 || x > SIZE - 8 || y < 8 || y > SIZE - 8) continue;
      const color = BALANCE.NETWORK.PLAYER_COLORS[ally.colorIndex] ?? 0x2b95ff;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.strokeStyle = '#101510';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fill();
    }

    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate(player.facingAngle);
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#101510';
    ctx.stroke();
    ctx.fillStyle = '#f5d69a';
    ctx.fill();
    ctx.restore();

    ctx.font = '700 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e4dfca';
    ctx.fillText('N', SIZE / 2, 25);
  }

  private drawTerrain(world: RenderWorldState, map: UrbanMap): void {
    const ctx = this.terrain.getContext('2d');
    if (!ctx) return;
    const { mapWidth, mapHeight } = world;
    ctx.setTransform(this.terrain.width / mapWidth, 0, 0, this.terrain.height / mapHeight, 0, 0);
    ctx.fillStyle = '#354438';
    ctx.fillRect(0, 0, mapWidth, mapHeight);
    ctx.fillStyle = '#5e645b';
    for (const row of [0.19, 0.81]) ctx.fillRect(0, mapHeight * row + 172, mapWidth, 72);
    for (const column of [0.355, 0.645]) ctx.fillRect(mapWidth * column - 36, 0, 72, mapHeight);
    for (const building of map.buildings) {
      const x = building.x - building.halfWidth;
      const y = building.y - building.halfHeight;
      ctx.fillStyle = '#807461';
      ctx.fillRect(x, y, building.halfWidth * 2, building.halfHeight * 2);
      ctx.strokeStyle = '#c8b89b';
      ctx.lineWidth = 9;
      ctx.strokeRect(x, y, building.halfWidth * 2, building.halfHeight * 2);
    }
    ctx.fillStyle = '#586e55';
    for (const prop of world.props) {
      if (prop.kind !== 'bush') continue;
      ctx.beginPath();
      ctx.arc(prop.x, prop.y, 12 * prop.scale, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.strokeStyle = '#9a6556';
    ctx.lineWidth = 14;
    ctx.strokeRect(0, 0, mapWidth, mapHeight);
  }
}
