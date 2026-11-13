export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Valida e normaliza um vetor de entrada (dx, dy).
 * - Valores não-finitos (NaN, Infinity) tornam-se 0.
 * - Se o comprimento do vetor for maior que 1 (ex.: diagonal de teclado (1, 1) com módulo sqrt(2)),
 *   normaliza para comprimento exatamente 1.
 * - Se o comprimento for <= 1 (ex.: joystick analógico parcial), preserva a magnitude proporcional,
 *   exceto na zona morta insignificante (< 1e-6).
 */
export function normalizeInputVector(dx: number, dy: number): Vec2 {
  const safeDx = Number.isFinite(dx) ? dx : 0;
  const safeDy = Number.isFinite(dy) ? dy : 0;

  const magSq = safeDx * safeDx + safeDy * safeDy;
  if (magSq < 1e-12) {
    return { x: 0, y: 0 };
  }

  if (magSq > 1) {
    const invMag = 1 / Math.sqrt(magSq);
    return {
      x: safeDx * invMag,
      y: safeDy * invMag,
    };
  }

  return { x: safeDx, y: safeDy };
}

/**
 * Restringe uma posição circular (x, y) de raio `radius` aos limites retangulares
 * [radius, mapWidth - radius] x [radius, mapHeight - radius].
 */
export function clampPositionToArena(
  x: number,
  y: number,
  radius: number,
  mapWidth: number,
  mapHeight: number
): Vec2 {
  const minX = radius;
  const maxX = Math.max(radius, mapWidth - radius);
  const minY = radius;
  const maxY = Math.max(radius, mapHeight - radius);

  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

/**
 * Aplica um único passo puro de movimento a partir de uma posição inicial,
 * direção de entrada (dx, dy), velocidade em px/s, delta em segundos e limites do mapa.
 */
export function stepEntityMovement(
  x: number,
  y: number,
  dx: number,
  dy: number,
  speedPxPerSec: number,
  dtSec: number,
  radius: number,
  mapWidth: number,
  mapHeight: number
): { x: number; y: number; vx: number; vy: number } {
  const norm = normalizeInputVector(dx, dy);
  const vx = norm.x * speedPxPerSec;
  const vy = norm.y * speedPxPerSec;
  const nextX = x + vx * dtSec;
  const nextY = y + vy * dtSec;
  const clamped = clampPositionToArena(nextX, nextY, radius, mapWidth, mapHeight);

  return {
    x: clamped.x,
    y: clamped.y,
    vx,
    vy,
  };
}
