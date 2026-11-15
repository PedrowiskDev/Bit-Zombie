import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { BALANCE } from '@zombie-coop/shared';
import { IsometricView } from '../src/render/IsometricView.js';

const target = { x: 23, y: 3980 };

describe('câmera isométrica', () => {
  it.each([[360, 800], [800, 360], [768, 1024], [1366, 768]])(
    'alinha a projeção Three e a mira, dentro do anel de spawn em %i×%i',
    (width, height) => {
      const controller = new IsometricView();
      const screen = { x: 10, y: 20, width, height };
      for (let zoom = 0; zoom < 3; zoom++) {
        const projection = controller.update(target, width, height, 16);
        const { width: spanX, height: spanY } = projection.ground;
        const center = projection.center;
        const offset = projection.cameraOffset(900);
        const camera = new OrthographicCamera(-spanX / 2, spanX / 2, spanY / 2, -spanY / 2, 1, 1800);
        camera.position.set(center.x + offset.x, offset.y, center.y + offset.z);
        camera.lookAt(center.x, 0, center.y);
        camera.updateMatrixWorld();

        for (const x of [screen.x, screen.x + width]) {
          for (const y of [screen.y, screen.y + height]) {
            const point = projection.screenToGround({ x, y }, screen);
            const actual = new Vector3(point.x, 0, point.y).project(camera);
            expect(screen.x + (actual.x + 1) * width / 2).toBeCloseTo(x, 4);
            expect(screen.y + (1 - actual.y) * height / 2).toBeCloseTo(y, 4);
            expect(Math.hypot(point.x - target.x, point.y - target.y)).toBeLessThan(BALANCE.SPAWN.RING_MIN_RADIUS);
          }
        }
        controller.changeZoom(1);
      }
    },
  );

  it('acompanha o jogador no mesmo ritmo a 30, 60 e 120 Hz', () => {
    const sample = (fps: number) => {
      const view = new IsometricView();
      view.update({ x: 100, y: 100 }, 960, 540, 0);
      let result = view.update({ x: 130, y: 140 }, 960, 540, 0);
      for (let i = 0; i < fps; i++) result = view.update({ x: 130, y: 140 }, 960, 540, 1000 / fps);
      return result.center;
    };
    expect(sample(30).x).toBeCloseTo(sample(120).x, 8);
    expect(sample(60).y).toBeCloseTo(sample(120).y, 8);
  });

  it('preserva a intensidade do joystick e move para o lado indicado na tela', () => {
    const projection = new IsometricView().update(target, 960, 540, 16);
    const world = projection.inputToGround({ x: 0.5, y: 0 });
    const screen = { x: 0, y: 0, width: 960, height: 540 };
    const result = projection.worldToScreen({ x: target.x + world.x, y: target.y + world.y }, screen);
    expect(result.x).toBeGreaterThan(480);
    expect(result.y).toBeCloseTo(270);
    expect(Math.hypot(world.x, world.y)).toBeCloseTo(0.5);
  });
});
