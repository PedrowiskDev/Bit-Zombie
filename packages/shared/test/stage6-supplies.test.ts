import { describe, expect, it } from 'vitest';
import { BALANCE, Simulation } from '../src/index.js';

describe('Etapa 6 — inventário de sobrevivência', () => {
  function create() {
    const sim = new Simulation({ seed: 643, enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();
    sim.addPlayer('p1', { x: 2000, y: 2000 });
    sim.addPlayer('p2', { x: 2040, y: 2000 });
    return sim;
  }

  it('transfere só a quantidade disponível e rejeita pedidos inválidos', () => {
    const sim = create();
    sim.addAmmo('p1', 'light', 12);
    const [sender, receiver] = sim.getSnapshot().players.map((p) => p.ammoLight ?? 0);
    expect(sim.moveSupply('p1', 'light', 4, 'share')).toBe(true);
    expect(sim.moveSupply('p1', 'light', sender - 3, 'share')).toBe(false);
    expect(sim.moveSupply('p1', 'light', 1.5, 'drop')).toBe(false);
    expect(sim.moveSupply('p1', 'constructor', 1, 'share')).toBe(false);
    expect(sim.getSnapshot().players.map((p) => p.ammoLight)).toEqual([sender - 4, receiver + 4]);
  });

  it('bloqueia a transferência através da parede e exige interação para pegar itens soltos', () => {
    const sim = create();
    sim.addWallSegment({ x1: 2020, y1: 1900, x2: 2020, y2: 2100,
      blocksMovement: true, blocksProjectiles: true, blocksVision: true });
    sim.addResource('p1', 'cloth', 3);
    expect(sim.moveSupply('p1', 'cloth', 1, 'share')).toBe(false);
    expect(sim.moveSupply('p1', 'cloth', 1, 'drop')).toBe(true);
    expect(sim.moveSupply('p1', 'cloth', 2, 'drop')).toBe(true);
    sim.step(BALANCE.SIMULATION.TICK_DT_MS);
    expect(sim.getSnapshot().lootItems).toMatchObject([{ kind: 'resource', resourceKind: 'cloth', resourceAmount: 3 }]);
    expect(sim.interactPlayerLoot('p2')).toBe(false);
    expect(sim.interactPlayerLoot('p1')).toBe(true);
    expect(sim.getSnapshot().players.map((p) => p.cloth)).toEqual([3, 0]);
    expect(sim.getSnapshot().lootItems).toHaveLength(0);
  });

  it('usa pano para curar quando acabam os kits médicos', () => {
    const sim = create();
    const kits = sim.getSnapshot().players[0].medkits ?? 0;
    if (kits > 0) expect(sim.moveSupply('p1', 'medkits', kits, 'share')).toBe(true);
    sim.addResource('p1', 'cloth', 1);
    sim.setPlayerHp('p1', 40);
    expect(sim.usePlayerMedkit('p1')).toBe(true);
    expect(sim.getSnapshot().players[0]).toMatchObject({ hp: 55, cloth: 0, medkits: 0 });
  });
});
