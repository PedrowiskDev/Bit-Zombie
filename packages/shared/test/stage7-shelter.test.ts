import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/index.js';

describe('Etapa 7 — abrigo', () => {
  it('exige modo exploração, marcador e materiais antes de construir', () => {
    const rounds = new Simulation({ gameMode: 'rounds', enableAutoSpawn: false });
    rounds.addPlayer('p', { x: 2000, y: 2000 });
    expect(rounds.buildPlayerStructure('p', 'shelter_marker')).toBeNull();
    expect(rounds.buildPlayerStructure('p', 'wood_barricade')).not.toBeNull();

    const sim = new Simulation({ gameMode: 'exploration', enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();
    sim.addPlayer('p', { x: 2000, y: 2000 });
    expect(sim.buildPlayerStructure('p', 'storage')).toBeNull();
    expect(sim.buildPlayerStructure('p', 'shelter_marker')).not.toBeNull();
    expect(sim.buildPlayerStructure('p', 'shelter_marker')).toBeNull();
    sim.addPlayer('q', { x: 2000, y: 2300 });
    expect(sim.buildPlayerStructure('q', 'storage')).not.toBeNull();
  });

  it('transfere estoque entre jogadores sem duplicação', () => {
    const sim = new Simulation({ gameMode: 'exploration', enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();
    sim.addPlayer('p', { x: 2000, y: 2000 });
    sim.buildPlayerStructure('p', 'shelter_marker');
    sim.addPlayer('q', { x: 2000, y: 2090 });
    expect(sim.buildPlayerStructure('q', 'storage')).not.toBeNull();
    sim.addPlayer('r', { x: 2050, y: 2130 });
    sim.addResource('q', 'cloth', 5);
    expect(sim.moveSupply('q', 'cloth', 5, 'deposit')).toBe(true);
    expect(sim.moveSupply('p', 'cloth', 1, 'withdraw')).toBe(false);
    expect(sim.moveSupply('r', 'cloth', 5, 'withdraw')).toBe(true);
    expect(sim.moveSupply('q', 'cloth', 1, 'withdraw')).toBe(false);
    expect(sim.getSnapshot().players.map((p) => p.cloth)).toEqual([0, 0, 5]);
  });
});
