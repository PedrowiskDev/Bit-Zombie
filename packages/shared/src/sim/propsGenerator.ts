import { BALANCE } from '../config/balance.js';
import { SeededRng } from '../math/rng.js';
import type { PropData, PropKind } from '../types/protocol.js';

const PROP_KINDS: readonly PropKind[] = ['car', 'crate', 'bush', 'rubble'];

/**
 * Gera props decorativos sem colisão de forma 100% determinística a partir de `seed`.
 * Preserva uma área limpa ao redor do centro de spawn dos jogadores e respeita margens da borda.
 */
export function generateMapProps(seed: number): PropData[] {
  const rng = new SeededRng(seed ^ 0x9e3779b9);
  const props: PropData[] = [];

  const { WIDTH, HEIGHT, PROP_EDGE_MARGIN, PROP_COUNT, SPAWN_CLEAR_RADIUS, PROP_MIN_SPACING } =
    BALANCE.MAP;
  const centerX = BALANCE.PLAYER.SPAWN_X;
  const centerY = BALANCE.PLAYER.SPAWN_Y;
  const clearRadiusSq = SPAWN_CLEAR_RADIUS * SPAWN_CLEAR_RADIUS;
  const minSpacingSq = PROP_MIN_SPACING * PROP_MIN_SPACING;

  const maxAttempts = PROP_COUNT * 8;
  let attempts = 0;

  while (props.length < PROP_COUNT && attempts < maxAttempts) {
    attempts += 1;
    const x = Math.round(rng.nextRange(PROP_EDGE_MARGIN, WIDTH - PROP_EDGE_MARGIN));
    const y = Math.round(rng.nextRange(PROP_EDGE_MARGIN, HEIGHT - PROP_EDGE_MARGIN));

    // Mantém a área central de spawn livre de props grandes
    const dxCenter = x - centerX;
    const dyCenter = y - centerY;
    if (dxCenter * dxCenter + dyCenter * dyCenter < clearRadiusSq) {
      continue;
    }

    // Evita sobreposição visual exagerada entre props próximos
    let tooClose = false;
    for (let i = 0; i < props.length; i += 1) {
      const other = props[i];
      const dx = x - other.x;
      const dy = y - other.y;
      if (dx * dx + dy * dy < minSpacingSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) {
      continue;
    }

    const roll = rng.nextFloat();
    let kind: PropKind;
    if (roll < 0.14) {
      kind = 'car';
    } else if (roll < 0.42) {
      kind = 'crate';
    } else if (roll < 0.78) {
      kind = 'bush';
    } else {
      kind = 'rubble';
    }

    const rotation = Number((rng.nextFloat() * Math.PI * 2).toFixed(4));
    const scale = Number(rng.nextRange(0.85, 1.2).toFixed(3));
    const variant = rng.nextInt(0, PROP_KINDS.length - 1);

    props.push({
      id: props.length + 1,
      kind,
      x,
      y,
      rotation,
      scale,
      variant,
    });
  }

  return props;
}
