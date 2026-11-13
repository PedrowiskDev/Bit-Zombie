import type { Vec2 } from './vec2.js';

export interface CircleOverlapResult {
  overlapping: boolean;
  nx: number;
  ny: number;
  overlap: number;
  dist: number;
}

/**
 * Verifica colisão círculo-círculo entre A(ax, ay, ar) e B(bx, by, br).
 * Retorna normal apontando de B para A e a penetração (`overlap > 0`).
 */
export function checkCircleCollision(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number
): CircleOverlapResult {
  const dx = ax - bx;
  const dy = ay - by;
  const minDist = ar + br;
  const distSq = dx * dx + dy * dy;

  if (distSq >= minDist * minDist) {
    return { overlapping: false, nx: 0, ny: 0, overlap: 0, dist: Math.sqrt(distSq) };
  }

  const dist = Math.sqrt(distSq);
  if (dist < 1e-6) {
    // Centros coincidentes: desempata de forma determinística no eixo X
    return { overlapping: true, nx: 1, ny: 0, overlap: minDist, dist: 0 };
  }

  return {
    overlapping: true,
    nx: dx / dist,
    ny: dy / dist,
    overlap: minDist - dist,
    dist,
  };
}

/**
 * Testa interseção contínua (swept circle / segmento-círculo) entre o deslocamento
 * de um projétil `(x0, y0) -> (x1, y1)` de raio `projRadius` e um alvo circular `(cx, cy, targetRadius)`.
 * Retorna a fração `t` em `[0, 1]` do primeiro impacto, ou `null` se não colidir.
 */
export function sweepCircleCircle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  projRadius: number,
  cx: number,
  cy: number,
  targetRadius: number
): { t: number; hitX: number; hitY: number } | null {
  const combinedRadius = projRadius + targetRadius;
  const combinedRadiusSq = combinedRadius * combinedRadius;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;

  // Já nasce sobreposto
  if (fx * fx + fy * fy <= combinedRadiusSq) {
    return { t: 0, hitX: x0, hitY: y0 };
  }

  const a = dx * dx + dy * dy;
  if (a < 1e-12) {
    return null;
  }

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - combinedRadiusSq;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const sqrtDisc = Math.sqrt(discriminant);
  const t = (-b - sqrtDisc) / (2 * a);

  if (t >= 0 && t <= 1) {
    return {
      t,
      hitX: x0 + dx * t,
      hitY: y0 + dy * t,
    };
  }

  return null;
}

/**
 * Grade espacial uniforme simples para consultas de vizinhança 2D.
 * Reduz comparações em distribuições espalhadas (mantendo determinismo pela ordem de inserção).
 */
export class SpatialHashGrid<T extends { id: number; x: number; y: number }> {
  private readonly cellSize: number;
  private readonly cells = new Map<number, T[]>();

  constructor(cellSize = 64) {
    this.cellSize = Math.max(16, cellSize);
  }

  clear(): void {
    this.cells.clear();
  }

  insert(item: T): void {
    const cx = Math.floor(item.x / this.cellSize);
    const cy = Math.floor(item.y / this.cellSize);
    const key = this.hashCoords(cx, cy);
    const bucket = this.cells.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      this.cells.set(key, [item]);
    }
  }

  queryNearby(x: number, y: number, radius: number): T[] {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    const results: T[] = [];
    for (let cy = minCy; cy <= maxCy; cy += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const bucket = this.cells.get(this.hashCoords(cx, cy));
        if (bucket) {
          for (let i = 0; i < bucket.length; i += 1) {
            results.push(bucket[i]);
          }
        }
      }
    }
    return results;
  }

  private hashCoords(cx: number, cy: number): number {
    // Empacota coordenadas inteiras de célula em inteiro de 32 bits
    return ((cx & 0xffff) << 16) | (cy & 0xffff);
  }
}

export function distanceBetween(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
