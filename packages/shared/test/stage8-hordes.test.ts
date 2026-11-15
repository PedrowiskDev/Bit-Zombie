import { describe, expect, it } from 'vitest';
import { BALANCE, Simulation, generateUrbanMap } from '../src/index.js';

describe('Etapa 8 — variantes de horda', () => {
  it('o cuspidor ataca à distância e respeita a recarga e as paredes', () => {
    const sim = new Simulation({ enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();
    sim.addPlayer('p', { x: 2000, y: 2000 });
    sim.spawnZombie('spitter', { x: 2180, y: 2000 });
    const dt = BALANCE.SIMULATION.TICK_DT_MS;
    sim.addWallSegment({ x1: 2090, x2: 2090, y1: 1900, y2: 2100,
      blocksVision: true, blocksProjectiles: true, blocksMovement: true });
    sim.step(dt);
    expect(sim.getSnapshot().players[0].hp).toBe(BALANCE.PLAYER.MAX_HP);
    sim.clearWallSegments();
    sim.step(dt);
    expect(sim.getSnapshot().players[0].hp).toBe(BALANCE.PLAYER.MAX_HP - 12);
    sim.step(dt);
    expect(sim.getSnapshot().players[0].hp).toBe(BALANCE.PLAYER.MAX_HP - 12);
  });

  it('reproduz a mesma trajetória e eventos com seis jogadores e 150 zumbis', () => {
    const seed = 482;
    const home = generateUrbanMap(seed).buildings[0];
    function setup() {
      const sim = new Simulation({ seed, enableAutoSpawn: false, startingWeapon: 'pistol' });
      sim.clearLootForTesting();
      for (let i = 0; i < 6; i++) sim.addPlayer(`p${i}`, { x: home.x - 18 + i * 7, y: home.y - 42 });
      for (let i = 0; i < 150; i++) {
        sim.spawnZombie(i % 3 === 0 ? 'brute' : 'common', {
          x: home.x - 220 + i % 15 * 31,
          y: home.y + home.halfHeight + 60 + Math.floor(i / 15) * 30,
        });
      }
      expect(sim.getSnapshot().zombies).toHaveLength(150);
      return sim;
    }
    const first = setup();
    const second = setup();
    for (let seq = 1; seq <= 150; seq++) {
      const inputs = { p0: { seq, dx: 0, dy: 0, aimMode: 'manual' as const, aimX: 0, aimY: -1, firing: seq === 1 } };
      first.step(BALANCE.SIMULATION.TICK_DT_MS, inputs);
      second.step(BALANCE.SIMULATION.TICK_DT_MS, inputs);
      expect(first.consumeEvents()).toEqual(second.consumeEvents());
    }
    expect(first.getSnapshot()).toEqual(second.getSnapshot());
  });
});
