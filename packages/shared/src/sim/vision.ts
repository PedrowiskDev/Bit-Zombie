import { BALANCE } from '../config/balance.js';
import { clampPositionToArena, type Vec2 } from '../math/vec2.js';
import type {
  BuildableStructureSnapshot,
  LootContainerSnapshot,
  PropData,
  PropKind,
  ZombieStateSnapshot,
} from '../types/protocol.js';

/**
 * Obstáculo circular para cálculo de colisão física, linha de visão (LOS) e bloqueio de projéteis.
 * - Carros e caixas altas bloqueiam movimento, visão e tiros.
 * - Arbustos, entulhos, maletas/caixas de loot e barricadas construídas são sólidos ao caminhar (`blocksMovement: true`),
 *   mas por serem objetos baixos não bloqueiam a visão nem disparos (`blocksVision: false`).
 */
export interface CircleObstacle {
  x: number;
  y: number;
  radius: number;
  blocksVision: boolean;
  blocksProjectiles: boolean;
  blocksMovement?: boolean;
  kind?: string;
}

/**
 * Segmento de reta sólido (paredes, portas fechadas, barricadas altas) para bloqueio físico, de visão e de tiros.
 */
export interface SegmentObstacle {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  blocksVision: boolean;
  blocksProjectiles: boolean;
  blocksMovement?: boolean;
}

/**
 * Conjunto consolidado de obstáculos do mapa para consultas de movimento, visão e combate.
 */
export interface VisionObstacles {
  circles: readonly CircleObstacle[];
  segments: readonly SegmentObstacle[];
}

export interface VisionConeCheckOptions {
  coneAngleDeg?: number;
  rangePx?: number;
  closeSenseRadiusPx?: number;
  targetRadiusPx?: number;
}

export interface VisionPolygonOptions {
  coneAngleDeg?: number;
  rangePx?: number;
  rayCount?: number;
}

/**
 * Define quais objetos do cenário bloqueiam a visão e projéteis na Etapa 2:
 * - `'car'` e `'crate'` são obstáculos sólidos altos -> bloqueiam visão e tiros.
 * - `'bush'` (arbusto pequeno) e `'rubble'` (entulho rasteiro) são objetos baixos -> NÃO bloqueiam visão nem tiros.
 */
export function doesPropBlockVision(kind: PropKind): boolean {
  return kind === 'car' || kind === 'crate';
}

/**
 * Raio efetivo de oclusão óptica/balística para props sólidos altos.
 */
export function getPropObstacleRadius(kind: PropKind, scale = 1): number {
  if (kind === 'car') {
    return 24 * scale;
  }
  if (kind === 'crate') {
    return 16 * scale;
  }
  return 0;
}

/**
 * Raio físico de colisão de movimento para todos os objetos do cenário.
 */
export function getPropPhysicalRadius(kind: PropKind, scale = 1): number {
  switch (kind) {
    case 'car':
      return 28 * scale;
    case 'crate':
      return 16 * scale;
    case 'bush':
      return 15 * scale;
    case 'rubble':
      return 13 * scale;
    default:
      return 14 * scale;
  }
}

/**
 * Constrói a estrutura de obstáculos de colisão física, visão e combate a partir dos props do mapa,
 * recipientes pesquisáveis, fortificações construídas e segmentos de parede/portas fechadas.
 */
export function buildObstaclesFromProps(
  props: readonly PropData[],
  extraSegments: readonly SegmentObstacle[] = [],
  extraCircles: readonly CircleObstacle[] = [],
  containers: readonly Pick<LootContainerSnapshot, 'x' | 'y' | 'kind'>[] = [],
  structures: readonly Pick<
    BuildableStructureSnapshot,
    'x' | 'y' | 'radius' | 'kind' | 'hp'
  >[] = []
): VisionObstacles {
  const circles: CircleObstacle[] = [...extraCircles];

  for (let i = 0; i < props.length; i += 1) {
    const p = props[i];
    if (p.kind === 'car') {
      // Carro (88x46 rotacionado): cápsula composta por 5 círculos sobrepostos ao longo do chassi
      const cosR = Math.cos(p.rotation);
      const sinR = Math.sin(p.rotation);
      const carRadius = 19 * p.scale;
      for (const offsetPx of [-22, -11, 0, 11, 22]) {
        const offset = offsetPx * p.scale;
        circles.push({
          x: p.x + cosR * offset,
          y: p.y + sinR * offset,
          radius: carRadius,
          blocksVision: true,
          blocksProjectiles: true,
          blocksMovement: true,
          kind: p.kind,
        });
      }
      continue;
    }

    const blocksVis = doesPropBlockVision(p.kind);
    const radius = getPropPhysicalRadius(p.kind, p.scale);
    if (radius > 0) {
      circles.push({
        x: p.x,
        y: p.y,
        radius,
        blocksVision: blocksVis,
        blocksProjectiles: blocksVis,
        blocksMovement: true,
        kind: p.kind,
      });
    }
  }

  for (let i = 0; i < containers.length; i += 1) {
    const c = containers[i];
    circles.push({
      x: c.x,
      y: c.y,
      radius: 14,
      blocksVision: false,
      blocksProjectiles: false,
      blocksMovement: true,
      kind: c.kind,
    });
  }

  for (let i = 0; i < structures.length; i += 1) {
    const s = structures[i];
    if (s.hp <= 0 || s.kind === 'spike_trap') {
      continue;
    }
    circles.push({
      x: s.x,
      y: s.y,
      radius: s.radius,
      blocksVision: false,
      blocksProjectiles: false,
      blocksMovement: true,
      kind: s.kind,
    });
  }

  return {
    circles,
    segments: extraSegments,
  };
}

/**
 * Resolve colisão física deslizante de uma entidade circular `(x, y, radius)` contra todos os
 * obstáculos sólidos do cenário (`circles` e `segments` com `blocksMovement !== false`),
 * mantendo a entidade dentro dos limites do mapa.
 */
export function resolveEntityObstacleCollisions(
  x: number,
  y: number,
  radius: number,
  obstacles: VisionObstacles | undefined,
  mapWidth: number = BALANCE.MAP.WIDTH,
  mapHeight: number = BALANCE.MAP.HEIGHT
): Vec2 {
  let resolvedX = x;
  let resolvedY = y;

  if (obstacles) {
    const circles = obstacles.circles;
    const segments = obstacles.segments;

    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < circles.length; i += 1) {
        const c = circles[i];
        if (c.blocksMovement === false) {
          continue;
        }
        const dx = resolvedX - c.x;
        const dy = resolvedY - c.y;
        const minDist = radius + c.radius;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDist * minDist) {
          continue;
        }
        const dist = Math.sqrt(distSq);
        if (dist > 1e-6) {
          const push = minDist - dist;
          resolvedX += (dx / dist) * push;
          resolvedY += (dy / dist) * push;
        } else {
          resolvedX += minDist;
        }
      }

      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i];
        if (seg.blocksMovement === false) {
          continue;
        }
        const abx = seg.x2 - seg.x1;
        const aby = seg.y2 - seg.y1;
        const abLenSq = abx * abx + aby * aby;
        let t = 0;
        if (abLenSq > 1e-8) {
          t = ((resolvedX - seg.x1) * abx + (resolvedY - seg.y1) * aby) / abLenSq;
          t = Math.max(0, Math.min(1, t));
        }
        const closestX = seg.x1 + abx * t;
        const closestY = seg.y1 + aby * t;
        const dx = resolvedX - closestX;
        const dy = resolvedY - closestY;
        const wallHalfThickness = 4;
        const minDist = radius + wallHalfThickness;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDist * minDist) {
          continue;
        }
        const dist = Math.sqrt(distSq);
        if (dist > 1e-6) {
          const push = minDist - dist;
          resolvedX += (dx / dist) * push;
          resolvedY += (dy / dist) * push;
        } else {
          resolvedY += minDist;
        }
      }
    }
  }

  return clampPositionToArena(resolvedX, resolvedY, radius, mapWidth, mapHeight);
}

/**
 * Normaliza qualquer ângulo em radianos para o intervalo `[-PI, PI]`.
 */
export function normalizeAngleRad(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) {
    a -= Math.PI * 2;
  } else if (a < -Math.PI) {
    a += Math.PI * 2;
  }
  return a;
}

/**
 * Retorna a menor diferença angular assinada `b - a` no intervalo `[-PI, PI]`.
 */
export function angleDifferenceRad(a: number, b: number): number {
  return normalizeAngleRad(b - a);
}

/**
 * Calcula a interseção de um raio `(ox, oy) + t * (dx, dy)` (onde `(dx, dy)` é unitário e `0 <= t <= maxDist`)
 * com um segmento `(x1, y1) -> (x2, y2)`.
 * Retorna a distância `t` até o impacto ou `null` se não houver interseção no intervalo.
 */
export function intersectRaySegment(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number | null {
  const sx = x2 - x1;
  const sy = y2 - y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-8) {
    return null;
  }

  const qpx = x1 - ox;
  const qpy = y1 - oy;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * dy - qpy * dx) / denom;

  if (t >= 0 && t <= maxDist && u >= 0 && u <= 1) {
    return t;
  }
  return null;
}

/**
 * Calcula a interseção de um raio `(ox, oy) + t * (dx, dy)` (onde `(dx, dy)` é unitário e `0 <= t <= maxDist`)
 * com um círculo `(cx, cy, r)`.
 * Retorna a distância `t` até a borda frontal do círculo ou `null` se não interceptar.
 */
export function intersectRayCircle(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  cx: number,
  cy: number,
  r: number
): number | null {
  const fx = ox - cx;
  const fy = oy - cy;

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;

  // Se a origem do raio já estiver ligeiramente dentro da borda do obstáculo, ignora auto-bloqueio
  if (c <= 0) {
    return null;
  }

  const discriminant = b * b - 4 * c;
  if (discriminant < 0) {
    return null;
  }

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) * 0.5;
  if (t1 >= 0 && t1 <= maxDist) {
    return t1;
  }
  return null;
}

/**
 * Verifica se o segmento entre `(fromX, fromY)` e `(toX, toY)` possui linha de visão limpa
 * (ou linha de tiro limpa quando `checkProjectiles = true`).
 */
export function hasLineOfSight(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  obstacles: VisionObstacles,
  checkProjectiles = false
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-5) {
    return true;
  }

  const ux = dx / dist;
  const uy = dy / dist;
  // Pequena margem para permitir atingir a superfície do alvo sem falso positivo no próprio ponto final
  const effectiveDist = Math.max(0, dist - 2);

  const segments = obstacles.segments;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (checkProjectiles ? !seg.blocksProjectiles : !seg.blocksVision) {
      continue;
    }
    const hitT = intersectRaySegment(
      fromX,
      fromY,
      ux,
      uy,
      effectiveDist,
      seg.x1,
      seg.y1,
      seg.x2,
      seg.y2
    );
    if (hitT !== null) {
      return false;
    }
  }

  const circles = obstacles.circles;
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i];
    if (checkProjectiles ? !c.blocksProjectiles : !c.blocksVision) {
      continue;
    }
    // Se o próprio alvo está dentro do raio do círculo testado, não oclui a si mesmo
    const targetDistSq = (toX - c.x) * (toX - c.x) + (toY - c.y) * (toY - c.y);
    if (targetDistSq <= c.radius * c.radius) {
      continue;
    }
    const hitT = intersectRayCircle(
      fromX,
      fromY,
      ux,
      uy,
      effectiveDist,
      c.x,
      c.y,
      c.radius
    );
    if (hitT !== null) {
      return false;
    }
  }

  return true;
}

/**
 *Encontra a primeira colisão de um segmento de projétil `(fromX, fromY) -> (toX, toY)` contra
 * obstáculos sólidos que bloqueiam projéteis.
 */
export function findProjectileObstacleHit(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  obstacles: VisionObstacles
): { tRatio: number; x: number; y: number } | null {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-6) {
    return null;
  }

  const ux = dx / dist;
  const uy = dy / dist;
  let bestDist = Number.POSITIVE_INFINITY;

  const segments = obstacles.segments;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (!seg.blocksProjectiles) {
      continue;
    }
    const hitDist = intersectRaySegment(
      fromX,
      fromY,
      ux,
      uy,
      dist,
      seg.x1,
      seg.y1,
      seg.x2,
      seg.y2
    );
    if (hitDist !== null && hitDist < bestDist) {
      bestDist = hitDist;
    }
  }

  const circles = obstacles.circles;
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i];
    if (!c.blocksProjectiles) {
      continue;
    }
    const hitDist = intersectRayCircle(
      fromX,
      fromY,
      ux,
      uy,
      dist,
      c.x,
      c.y,
      c.radius
    );
    if (hitDist !== null && hitDist < bestDist) {
      bestDist = hitDist;
    }
  }

  if (!Number.isFinite(bestDist)) {
    return null;
  }

  return {
    tRatio: bestDist / dist,
    x: fromX + ux * bestDist,
    y: fromY + uy * bestDist,
  };
}

/**
 * Avalia se um ponto/entidade `(targetX, targetY)` está visível para o jogador em `(viewerX, viewerY)`
 * olhando na direção `facingAngleRad`:
 * 1. Deve estar dentro do alcance `rangePx` (considerando `targetRadiusPx`).
 * 2. Deve estar dentro do cone de visão (`coneAngleDeg`, padrão 110°) OU dentro do raio imediato `closeSenseRadiusPx`.
 * 3. Deve possuir linha de visão desobstruída (`hasLineOfSight`) sem paredes, portas fechadas ou obstáculos sólidos no meio.
 */
export function isPointInVisionCone(
  viewerX: number,
  viewerY: number,
  facingAngleRad: number,
  targetX: number,
  targetY: number,
  obstacles: VisionObstacles,
  options: VisionConeCheckOptions = {}
): boolean {
  const coneAngleDeg = options.coneAngleDeg ?? BALANCE.VISION.CONE_ANGLE_DEG;
  const rangePx = options.rangePx ?? BALANCE.VISION.RANGE_PX;
  const closeSenseRadiusPx =
    options.closeSenseRadiusPx ?? BALANCE.VISION.CLOSE_SENSE_RADIUS_PX;
  const targetRadiusPx = options.targetRadiusPx ?? 0;

  const dx = targetX - viewerX;
  const dy = targetY - viewerY;
  const dist = Math.hypot(dx, dy);

  if (dist > rangePx + targetRadiusPx) {
    return false;
  }

  if (dist > closeSenseRadiusPx + targetRadiusPx) {
    const angleToTarget = Math.atan2(dy, dx);
    const angleDiff = Math.abs(angleDifferenceRad(facingAngleRad, angleToTarget));
    const halfConeRad = ((coneAngleDeg * 0.5) * Math.PI) / 180;
    // Tolerância angular proporcional ao raio do alvo para não ocultar metade do corpo na borda do cone
    const angularSlack = dist > 1 ? Math.atan2(targetRadiusPx, dist) : 0;
    if (angleDiff > halfConeRad + angularSlack) {
      return false;
    }
  }

  return hasLineOfSight(viewerX, viewerY, targetX, targetY, obstacles, false);
}

/**
 * Lança um raio de visão na direção `angleRad` até `maxRangePx`, retornando o ponto final recortado
 * pelo primeiro obstáculo sólido que bloqueia visão.
 */
export function castVisionRay(
  ox: number,
  oy: number,
  angleRad: number,
  maxRangePx: number,
  obstacles: VisionObstacles
): { x: number; y: number; distance: number; hitObstacle: boolean } {
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  let bestDist = maxRangePx;
  let hitObstacle = false;

  const segments = obstacles.segments;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (!seg.blocksVision) {
      continue;
    }
    const t = intersectRaySegment(
      ox,
      oy,
      dx,
      dy,
      bestDist,
      seg.x1,
      seg.y1,
      seg.x2,
      seg.y2
    );
    if (t !== null && t < bestDist) {
      bestDist = t;
      hitObstacle = true;
    }
  }

  const circles = obstacles.circles;
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i];
    if (!c.blocksVision) {
      continue;
    }
    const t = intersectRayCircle(ox, oy, dx, dy, bestDist, c.x, c.y, c.radius);
    if (t !== null && t < bestDist) {
      bestDist = t;
      hitObstacle = true;
    }
  }

  return {
    x: ox + dx * bestDist,
    y: oy + dy * bestDist,
    distance: bestDist,
    hitObstacle,
  };
}

/**
 * Constrói o polígono do cone de visão (em coordenadas de mundo) recortado por obstáculos sólidos.
 * O primeiro vértice é a posição do jogador `(viewerX, viewerY)` e os demais formam o arco visível.
 */
export function computeVisionPolygon(
  viewerX: number,
  viewerY: number,
  facingAngleRad: number,
  obstacles: VisionObstacles,
  options: VisionPolygonOptions = {}
): Vec2[] {
  const coneAngleDeg = options.coneAngleDeg ?? BALANCE.VISION.CONE_ANGLE_DEG;
  const rangePx = options.rangePx ?? BALANCE.VISION.RANGE_PX;
  const rayCount = Math.max(8, options.rayCount ?? BALANCE.VISION.RAY_COUNT);

  const halfConeRad = ((coneAngleDeg * 0.5) * Math.PI) / 180;
  const startAngle = facingAngleRad - halfConeRad;
  const stepAngle = (halfConeRad * 2) / (rayCount - 1);

  const points: Vec2[] = [{ x: viewerX, y: viewerY }];
  for (let i = 0; i < rayCount; i += 1) {
    const angle = startAngle + i * stepAngle;
    const hit = castVisionRay(viewerX, viewerY, angle, rangePx, obstacles);
    points.push({ x: hit.x, y: hit.y });
  }

  return points;
}

/**
 * Filtra e retorna o zumbi vivo mais próximo que esteja DENTRO do cone de visão atual do jogador,
 * dentro do alcance da arma (`maxRangePx`) e com linha de visão válida (`hasLineOfSight`).
 * Usado pelo modo de disparo automático na Etapa 2 para garantir que o auto-fire jamais mire
 * através de paredes ou gire a visão para descobrir inimigos nas costas do jogador.
 */
export function findClosestVisibleZombieInCone(
  viewerX: number,
  viewerY: number,
  facingAngleRad: number,
  maxRangePx: number,
  zombies: readonly ZombieStateSnapshot[],
  obstacles: VisionObstacles,
  coneAngleDeg: number = BALANCE.VISION.CONE_ANGLE_DEG
): ZombieStateSnapshot | null {
  const effectiveRange = Math.min(maxRangePx, BALANCE.VISION.RANGE_PX);
  let closest: ZombieStateSnapshot | null = null;
  let bestDistSq = effectiveRange * effectiveRange;

  for (let i = 0; i < zombies.length; i += 1) {
    const z = zombies[i];
    if (z.hp <= 0) {
      continue;
    }
    const dx = z.x - viewerX;
    const dy = z.y - viewerY;
    const distSq = dx * dx + dy * dy;
    if (distSq > bestDistSq) {
      continue;
    }

    const visible = isPointInVisionCone(
      viewerX,
      viewerY,
      facingAngleRad,
      z.x,
      z.y,
      obstacles,
      {
        coneAngleDeg,
        rangePx: effectiveRange,
        targetRadiusPx: z.radius,
      }
    );
    if (!visible) {
      continue;
    }

    bestDistSq = distSq;
    closest = z;
  }

  return closest;
}
