import { describe, expect, it } from 'vitest';
import { BALANCE, Simulation, createZombieEntity, generateUrbanMap } from '../src/index.js';
import { canZombieSee, ZombiePerception } from '../src/sim/zombiePerception.js';
import { planZombieDetour } from '../src/sim/zombieNavigation.js';

describe('Etapa 5 — percepção e navegação dos zumbis', () => {
  const dt = BALANCE.SIMULATION.TICK_DT_MS;

  it('investiga disparos através de uma parede opaca', () => {
    const sim = new Simulation({ seed: 482, enableAutoSpawn: false, startingWeapon: 'pistol' });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();
    sim.addWallSegment({ x1: 1900, y1: 1850, x2: 1900, y2: 2150,
      blocksVision: true, blocksProjectiles: true, blocksMovement: true });
    sim.addPlayer('p', { x: 1850, y: 2000 });
    sim.spawnZombie('common', { x: 2000, y: 2000 });
    sim.step(dt, { p: { seq: 1, dx: 0, dy: 0, aimMode: 'manual', aimX: -1, aimY: 0, firing: true } });
    let wentAround = false;
    for (let i = 0; i < 140; i++) {
      sim.step(dt);
      const { x, y } = sim.getSnapshot().zombies[0];
      if (x < 1900) {
        wentAround = y < 1850 || y > 2150;
        break;
      }
    }
    expect(wentAround).toBe(true);
  });

  it('contorna o prédio após ouvir um tiro e derruba a porta para entrar', () => {
    const seed = 482;
    const b = generateUrbanMap(seed).buildings[5];
    const sim = new Simulation({ seed, enableAutoSpawn: false, startingWeapon: 'pistol' });
    sim.clearLootForTesting();
    sim.addPlayer('p', { x: b.x, y: b.y + 35 });
    sim.spawnZombie('brute', { x: b.x + b.halfWidth + 45, y: b.y });
    for (let i = 1; i <= 320; i++) {
      sim.step(dt, { p: { seq: i, dx: 0, dy: 0, aimMode: 'manual', aimX: -1, aimY: 0, firing: i === 1 } });
    }
    const state = sim.getSnapshot();
    expect(state.structures?.find((door) => door.id === b.doorId)?.hp).toBe(0);
    expect(state.zombies[0].y).toBeLessThan(b.y + b.halfHeight);
  });

  it('atravessa a porta da casa e o vão interno ao investigar um disparo na cozinha', () => {
    const seed = 482;
    const { buildings: [b], house } = generateUrbanMap(seed);
    const sim = new Simulation({ seed, enableAutoSpawn: false, startingWeapon: 'pistol' });
    sim.clearLootForTesting();
    sim.addPlayer('p', { x: b.x + 65, y: b.y - 40 });
    sim.spawnZombie('brute', { x: b.x + 60, y: b.y + b.halfHeight + 40 });
    for (let i = 1; i <= 240; i++) {
      sim.step(dt, { p: { seq: i, dx: 0, dy: 0, aimMode: 'manual', aimX: 0, aimY: -1, firing: i === 1 } });
      const state = sim.getSnapshot();
      if (state.zombies[0].y < house!.partitionY - 5) {
        expect(state.structures?.find(door => door.id === b.doorId)?.hp).toBe(0);
        return;
      }
    }
    expect(sim.getSnapshot().zombies[0].y).toBeLessThan(house!.partitionY - 5);
  });

  it('distingue frente, costas, percepção próxima e parede opaca', () => {
    const sim = new Simulation({ enableAutoSpawn: false });
    sim.addPlayer('p', { x: 2200, y: 2000 });
    const player = sim.getSnapshot().players[0];
    const zombie = createZombieEntity(1, 'common', 2000, 2000);
    const clear = { segments: [], circles: [] };
    expect(canZombieSee(zombie, player, clear)).toBe(true);
    expect(canZombieSee(zombie, { ...player, x: 1800 }, clear)).toBe(false);
    expect(canZombieSee(zombie, { ...player, x: 1920 }, clear)).toBe(true);
    expect(canZombieSee(zombie, player, {
      circles: [], segments: [{
        x1: 2100, y1: 1980, x2: 2100, y2: 2020, blocksVision: true, blocksProjectiles: true,
      }],
    })).toBe(false);
  });

  it('abandona o último ponto conhecido quando a busca expira', () => {
    const sim = new Simulation({ enableAutoSpawn: false });
    sim.addPlayer('p', { x: 2200, y: 2000 });
    const player = sim.getSnapshot().players[0];
    const zombie = createZombieEntity(1, 'common', 2000, 2000);
    const ai = new ZombiePerception();
    const map = generateUrbanMap(482, 1000, 1000);
    const clear = { segments: [], circles: [] };
    const see = (time: number, players: typeof player[]) => ai.target(zombie, players, [], time, clear, map, 4000, 4000);
    expect(see(50, [player])).toEqual({ x: 2200, y: 2000 });
    expect(see(100, [])).toEqual({ x: 2200, y: 2000 });
    expect(see(5700, [])).not.toEqual({ x: 2200, y: 2000 });
  });

  it('invalida a trajetória ao construir ou remover uma parede durante a perseguição', () => {
    const ai = new ZombiePerception();
    const zombie = createZombieEntity(1, 'common', 150, 150);
    const goal = { x: 250, y: 150, radius: 320 };
    const map = generateUrbanMap(482, 1000, 1000);
    const clear = { segments: [], circles: [] };
    const wall = { x1: 200, y1: 110, x2: 200, y2: 190, blocksVision: true, blocksProjectiles: true };
    expect(ai.target(zombie, [], [goal], 50, clear, map, 1000, 1000)).toEqual({ x: 250, y: 150 });
    const detour = ai.target(zombie, [], [], 100, { segments: [wall], circles: [] }, map, 1000, 1000);
    expect(detour.y).not.toBe(150);
    expect(ai.target(zombie, [], [], 150, clear, map, 1000, 1000)).toEqual({ x: 250, y: 150 });
  });

  it('encontra uma rota de mais de uma curva ao longo de paredes em L', () => {
    const wall = (x1: number, y1: number, x2: number, y2: number) => ({
      x1, y1, x2, y2, blocksVision: true, blocksProjectiles: true,
    });
    const start = { x: 230, y: 130 };
    const goal = { x: 160, y: 220 };
    const route = planZombieDetour(start, goal, 14, {
      segments: [wall(200, 60, 200, 175), wall(200, 175, 325, 175)],
      circles: [],
    }, 400, 400);
    expect(route.length).toBeGreaterThan(2);
    expect(route.at(-1)).toEqual(goal);
  });
});
