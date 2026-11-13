import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  Simulation,
  clampPositionToArena,
  generateMapProps,
  normalizeInputVector,
} from '../src/index.js';

describe('Simulation — Etapa 2: Movimento, Normalização, Limites e Determinismo', () => {
  const tickMs = BALANCE.SIMULATION.TICK_DT_MS; // 50 ms
  const expectedStepDistance =
    BALANCE.PLAYER.SPEED_PX_PER_SEC * BALANCE.SIMULATION.TICK_DT_SEC; // 180 * 0.05 = 9 px

  it('move corretamente nas 4 direções cardinais (N, S, L, O) a 180 px/s (9 px por tick de 50 ms)', () => {
    const sim = new Simulation({ seed: 101 });
    sim.addPlayer('p1', { x: 2000, y: 2000 });

    // Direita (+X)
    sim.step(tickMs, { p1: { seq: 1, dx: 1, dy: 0 } });
    let snap = sim.getSnapshot();
    expect(snap.players[0].x).toBeCloseTo(2000 + expectedStepDistance, 5);
    expect(snap.players[0].y).toBeCloseTo(2000, 5);

    // Esquerda (-X)
    sim.step(tickMs, { p1: { seq: 2, dx: -1, dy: 0 } });
    snap = sim.getSnapshot();
    expect(snap.players[0].x).toBeCloseTo(2000, 5);
    expect(snap.players[0].y).toBeCloseTo(2000, 5);

    // Baixo (+Y)
    sim.step(tickMs, { p1: { seq: 3, dx: 0, dy: 1 } });
    snap = sim.getSnapshot();
    expect(snap.players[0].x).toBeCloseTo(2000, 5);
    expect(snap.players[0].y).toBeCloseTo(2000 + expectedStepDistance, 5);

    // Cima (-Y)
    sim.step(tickMs, { p1: { seq: 4, dx: 0, dy: -1 } });
    snap = sim.getSnapshot();
    expect(snap.players[0].x).toBeCloseTo(2000, 5);
    expect(snap.players[0].y).toBeCloseTo(2000, 5);
  });

  it('normaliza velocidade na diagonal para que o deslocamento total seja 9 px por tick (e não 9 * sqrt(2))', () => {
    const sim = new Simulation({ seed: 202 });
    sim.addPlayer('p1', { x: 2000, y: 2000 });

    // Diagonal Sudeste (dx=1, dy=1)
    sim.step(tickMs, { p1: { seq: 1, dx: 1, dy: 1 } });
    const snap = sim.getSnapshot();
    const p = snap.players[0];

    const distMoved = Math.hypot(p.x - 2000, p.y - 2000);
    expect(distMoved).toBeCloseTo(expectedStepDistance, 5);
    expect(p.x - 2000).toBeCloseTo(expectedStepDistance / Math.sqrt(2), 5);
    expect(p.y - 2000).toBeCloseTo(expectedStepDistance / Math.sqrt(2), 5);
  });

  it('limita vetores adulterados com magnitude > 1 e preserva vetores analógicos suaves com magnitude <= 1', () => {
    const oversized = normalizeInputVector(50, 0);
    expect(oversized.x).toBeCloseTo(1, 5);
    expect(oversized.y).toBeCloseTo(0, 5);

    const analogHalf = normalizeInputVector(0.5, 0);
    expect(analogHalf.x).toBeCloseTo(0.5, 5);
    expect(analogHalf.y).toBeCloseTo(0, 5);

    const invalid = normalizeInputVector(Number.NaN, Number.POSITIVE_INFINITY);
    expect(invalid).toEqual({ x: 0, y: 0 });
  });

  it('respeita os limites do mapa (4000x4000) considerando o raio do jogador (14 px)', () => {
    const radius = BALANCE.PLAYER.RADIUS; // 14
    const width = BALANCE.MAP.WIDTH; // 4000
    const height = BALANCE.MAP.HEIGHT; // 4000

    // Testa borda superior-esquerda
    const simTopLeft = new Simulation({ seed: 303 });
    simTopLeft.addPlayer('p1', { x: radius + 2, y: radius + 2 });
    simTopLeft.step(tickMs, { p1: { seq: 1, dx: -1, dy: -1 } });
    const pTopLeft = simTopLeft.getSnapshot().players[0];
    expect(pTopLeft.x).toBe(radius);
    expect(pTopLeft.y).toBe(radius);

    // Testa borda inferior-direita
    const simBottomRight = new Simulation({ seed: 304 });
    simBottomRight.addPlayer('p1', { x: width - radius - 2, y: height - radius - 2 });
    simBottomRight.step(tickMs, { p1: { seq: 1, dx: 1, dy: 1 } });
    const pBottomRight = simBottomRight.getSnapshot().players[0];
    expect(pBottomRight.x).toBe(width - radius);
    expect(pBottomRight.y).toBe(height - radius);

    // Clamp direto
    expect(clampPositionToArena(-100, 5000, radius, width, height)).toEqual({
      x: radius,
      y: height - radius,
    });
  });

  it('ignora comandos duplicados ou atrasados (seq <= lastProcessedSeq) e só avança lastProcessedSeq em comandos novos', () => {
    const sim = new Simulation({ seed: 404 });
    sim.addPlayer('p1', { x: 1000, y: 1000 });

    // Comando válido seq=1
    sim.step(tickMs, { p1: { seq: 1, dx: 1, dy: 0 } });
    let p = sim.getSnapshot().players[0];
    expect(p.lastProcessedSeq).toBe(1);
    expect(p.x).toBeCloseTo(1009, 5);

    // Comando duplicado seq=1 deve ser ignorado (jogador fica parado neste tick)
    sim.step(tickMs, { p1: { seq: 1, dx: 1, dy: 0 } });
    p = sim.getSnapshot().players[0];
    expect(p.lastProcessedSeq).toBe(1);
    expect(p.x).toBeCloseTo(1009, 5);

    // Tick sem comando mantém lastProcessedSeq inalterado
    sim.step(tickMs, {});
    p = sim.getSnapshot().players[0];
    expect(p.lastProcessedSeq).toBe(1);
    expect(p.x).toBeCloseTo(1009, 5);
  });

  it('mantém getSnapshot() livre de efeitos colaterais e consome eventos apenas uma vez via consumeEvents()', () => {
    const sim = new Simulation({ seed: 505 });
    sim.addPlayer('p1', { x: 2000, y: 2000 });

    const snap1 = sim.getSnapshot();
    const snap2 = sim.getSnapshot();
    expect(snap1).toEqual(snap2);

    const eventsFirstRead = sim.consumeEvents();
    expect(eventsFirstRead).toHaveLength(1);
    expect(eventsFirstRead[0].eventId).toBe(1);
    expect(eventsFirstRead[0].type).toBe('player_spawned');

    const eventsSecondRead = sim.consumeEvents();
    expect(eventsSecondRead).toHaveLength(0);
  });

  it('é 100% determinística para a mesma seed e sequência de entradas', () => {
    const simA = new Simulation({ seed: 99999 });
    const simB = new Simulation({ seed: 99999 });
    const simDifferent = new Simulation({ seed: 11111 });

    simA.addPlayer('p1');
    simB.addPlayer('p1');
    simDifferent.addPlayer('p1');

    const script: Array<{ seq: number; dx: number; dy: number }> = [
      { seq: 1, dx: 1, dy: 0 },
      { seq: 2, dx: 1, dy: -1 },
      { seq: 3, dx: 0, dy: -1 },
      { seq: 4, dx: -0.6, dy: 0.8 },
      { seq: 5, dx: 0, dy: 0 },
    ];

    for (const cmd of script) {
      simA.step(tickMs, { p1: cmd });
      simB.step(tickMs, { p1: cmd });
      simDifferent.step(tickMs, { p1: cmd });
    }

    expect(simA.getSnapshot()).toEqual(simB.getSnapshot());
    expect(generateMapProps(99999)).toEqual(generateMapProps(99999));
    expect(simA.getSnapshot().props).not.toEqual(simDifferent.getSnapshot().props);
  });
});
