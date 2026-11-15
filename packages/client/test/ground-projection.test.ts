import { describe, expect, it } from 'vitest';
import { GroundProjection } from '../src/render/GroundProjection.js';

describe('projeção ortográfica do chão', () => {
  it.each([[360, 800], [800, 360], [768, 1024], [1366, 768]])(
    'mantém alvos alinhados em %i×%i CSS, mesmo com canvas deslocado',
    (width, height) => {
      const projection = new GroundProjection({ x: 0, y: 3100, width: 480, height: 720 });
      const screen = { x: 15, y: 27, width, height };
      const target = { x: 120, y: 3640 };
      const pointer = projection.worldToScreen(target, screen);
      expect(pointer.x).toBeCloseTo(15 + width / 4);
      expect(pointer.y).toBeCloseTo(27 + height * 0.75);
      const result = projection.screenToGround(pointer, screen);
      expect(result.x).toBeCloseTo(target.x);
      expect(result.y).toBeCloseTo(target.y);
    },
  );

  it('mapeia o mesmo ponto após a resolução do buffer dobrar', () => {
    const projection = new GroundProjection({ x: 500, y: 1100, width: 960, height: 540 });
    const css = { x: 0, y: 0, width: 1366, height: 768 };
    const buffer = { ...css, width: css.width * 2, height: css.height * 2 };
    const pointer = { x: 330, y: 600 };
    const pixel = { x: pointer.x * 2, y: pointer.y * 2 };
    expect(projection.screenToGround(pointer, css)).toEqual(projection.screenToGround(pixel, buffer));
  });
});
