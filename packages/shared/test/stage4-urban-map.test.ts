import { describe, expect, it } from 'vitest';
import { BALANCE, Simulation, buildObstaclesFromProps, generateUrbanMap, hasLineOfSight, resolveEntityObstacleCollisions } from '../src/index.js';

describe('Etapa 4 — mapa urbano explorável', () => {
  const seed = 482;
  const map = generateUrbanMap(seed);
  const building = map.buildings[5];
  const entrance = map.doors[5];
  const dt = BALANCE.SIMULATION.TICK_DT_MS;

  it('gera os mesmos prédios com a mesma seed e varia a geografia entre partidas', () => {
    expect(map.buildings).toHaveLength(6);
    expect(generateUrbanMap(seed)).toEqual(map);
    expect(generateUrbanMap(seed + 1).buildings).not.toEqual(map.buildings);
  });

  it.each([1, 482, 4242, 91257])('mantém a entrada e o corredor da casa transitáveis na seed %i', (seed) => {
    const layout = generateUrbanMap(seed);
    const home = layout.house!;
    const door = layout.doors.find(candidate => candidate.id === home.doorId)!;
    const open = buildObstaclesFromProps([], [...layout.walls, ...layout.windows], home.furniture, [],
      [{ ...door, open: true }]);
    const radius = BALANCE.ROUNDS.ELITE_RADIUS_PX;
    const backWallClearance = radius + 4;
    for (let y = door.y + 30; y >= layout.buildings[0].y - layout.buildings[0].halfHeight + backWallClearance; y -= 2) {
      const resolved = resolveEntityObstacleCollisions(door.x, y, radius, open);
      expect(resolved).toEqual({ x: door.x, y });
    }
    for (const item of home.furniture) {
      const from = { x: item.x, y: item.y - item.radius - 5 };
      const to = { x: item.x, y: item.y + item.radius + 5 };
      expect(resolveEntityObstacleCollisions(item.x, item.y, 14, open)).not.toEqual({ x: item.x, y: item.y });
      expect(hasLineOfSight(from.x, from.y, to.x, to.y, open)).toBe(!item.blocksVision);
      expect(hasLineOfSight(from.x, from.y, to.x, to.y, open, true)).toBe(!item.blocksProjectiles);
    }
  });

  it('permite entrar, coletar a caixa na cozinha e sair pelo mesmo corredor', () => {
    const layout = generateUrbanMap(seed);
    const home = layout.house!;
    const door = layout.doors[0];
    const sim = new Simulation({ seed, enableAutoSpawn: false });
    sim.addPlayer('p', { x: door.x, y: door.y + 26 });
    expect(sim.interactPlayerLoot('p')).toBe(true);
    let seq = 0;
    const walk = (dy: number) => sim.step(dt, { p: { seq: ++seq, dx: 0, dy, aimMode: 'manual' } });
    for (let i = 0; i < 30 && sim.getSnapshot().players[0].y > home.supply.y + 12; i++) walk(-1);
    expect(sim.getSnapshot().players[0].y).toBeLessThan(home.partitionY);
    const crate = sim.getSnapshot().lootContainers?.find(item => item.label === 'Casa');
    expect(crate).toMatchObject(home.supply);
    expect(sim.interactPlayerLoot('p')).toBe(true);
    expect(sim.getSnapshot().lootContainers?.find(item => item.id === crate?.id)?.opened).toBe(true);
    for (let i = 0; i < 30 && sim.getSnapshot().players[0].y <= door.y + 20; i++) walk(1);
    expect(sim.getSnapshot().players[0].y).toBeGreaterThan(door.y);
  });

  it('bloqueia a passagem com a porta fechada e libera a entrada após interação', () => {
    const sim = new Simulation({ seed, enableAutoSpawn: false });
    sim.addPlayer('p', { x: entrance.x, y: entrance.y + 26 });
    const walk = (seq: number) => sim.step(dt, { p: { seq, dx: 0, dy: -1, aimMode: 'manual' } });
    for (let i = 1; i <= 8; i++) walk(i);
    expect(sim.getSnapshot().players[0].y).toBeGreaterThan(entrance.y);

    expect(sim.interactPlayerLoot('p')).toBe(true);
    expect(sim.getSnapshot().structures?.find((door) => door.id === entrance.id)?.open).toBe(true);
    for (let i = 9; i <= 10; i++) walk(i);
    expect(sim.interactPlayerLoot('p')).toBe(false);
    for (let i = 11; i <= 20; i++) walk(i);
    expect(sim.getSnapshot().players[0].y).toBeLessThan(entrance.y);
  });

  it('permite visão e tiros pela janela e mantém a passagem bloqueada', () => {
    const x = building.x;
    const y = building.y - building.halfHeight;
    const obstacles = buildObstaclesFromProps([], [...map.walls, ...map.windows], [], [], map.doors);
    expect(hasLineOfSight(x, y - 25, x, y + 25, obstacles)).toBe(true);
    expect(hasLineOfSight(x, y - 25, x, y + 25, obstacles, true)).toBe(true);
    expect(resolveEntityObstacleCollisions(x, y - 2, 14, obstacles).y).toBe(y - 18);
    expect(hasLineOfSight(x + 55, y - 25, x + 55, y + 25, obstacles)).toBe(false);
  });

  it('permite destruir portas com tiros e restaura todas no reinício', () => {
    const sim = new Simulation({ seed, enableAutoSpawn: false, startingWeapon: 'pistol' });
    sim.addPlayer('p', { x: entrance.x, y: entrance.y + 34 });
    const readDoor = () => sim.getSnapshot().structures?.find((door) => door.id === entrance.id);
    for (let i = 1; i <= 70; i++) {
      sim.step(dt, { p: { seq: i, dx: 0, dy: 0, aimMode: 'manual', aimX: 0, aimY: -1, firing: true } });
    }
    expect(readDoor()?.hp).toBe(0);
    sim.resetMatch(seed);
    expect(readDoor()?.hp).toBe(entrance.maxHp);
  });

  it('entrega os kits da clínica uma só vez no cooperativo', () => {
    const sim = new Simulation({ seed, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: building.x - 30, y: building.y });
    sim.addPlayer('p2', { x: building.x + 30, y: building.y });
    expect(sim.interactPlayerLoot('p1')).toBe(true);
    expect(sim.interactPlayerLoot('p2')).toBe(false);
    expect(sim.getSnapshot().players.map((p) => p.medkits)).toEqual([
      BALANCE.SURVIVAL.STARTING_MEDKITS + 3, BALANCE.SURVIVAL.STARTING_MEDKITS,
    ]);
  });
});
