import { describe, expect, it } from 'vitest';
import { BALANCE, Simulation } from '../src/index.js';

describe('Etapa 4 — Abrigo, Recursos, Fortificação (Barricadas/Armadilhas/Reparo) e Suprimento Médico', () => {
  it('inicia jogadores com recursos de sobrevivência (madeira, sucata e kit médico) e concede bônus ao abrir recipientes', () => {
    const sim = new Simulation({ seed: 4001, enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();

    const p1 = sim.addPlayer('p1', { x: 2000, y: 2000 });
    expect(p1.wood).toBe(BALANCE.SURVIVAL.STARTING_WOOD);
    expect(p1.scrap).toBe(BALANCE.SURVIVAL.STARTING_SCRAP);
    expect(p1.medkits).toBe(BALANCE.SURVIVAL.STARTING_MEDKITS);

    // Spawna uma caixa de suprimentos ao lado do jogador e abre com interactPlayerLoot
    sim.spawnLootContainer({
      kind: 'supply_crate',
      x: 2030,
      y: 2000,
      label: 'Caixa de Suprimentos',
      contents: [{ kind: 'ammo', ammoType: 'light', ammoAmount: 24 }],
    });

    const opened = sim.interactPlayerLoot('p1');
    expect(opened).toBe(true);

    const snap = sim.getSnapshot();
    const updatedP1 = snap.players.find((p) => p.id === 'p1')!;
    expect(updatedP1.wood).toBe(
      BALANCE.SURVIVAL.STARTING_WOOD + BALANCE.SURVIVAL.CONTAINER_BONUS_WOOD
    );
    expect(updatedP1.scrap).toBe(
      BALANCE.SURVIVAL.STARTING_SCRAP + BALANCE.SURVIVAL.CONTAINER_BONUS_SCRAP
    );
  });

  it('constrói barricada de madeira, barricada reforçada e armadilha de espinhos descontando recursos e contabilizando structuresBuilt', () => {
    const sim = new Simulation({ seed: 4002, enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();

    sim.addPlayer('p1', { x: 2000, y: 2000 });
    sim.addResource('p1', 'wood', 10);
    sim.addResource('p1', 'scrap', 10);
    sim.consumeEvents();

    // 1. Constrói Barricada de Madeira (custo: 2 Madeira)
    const woodBarricade = sim.buildPlayerStructure('p1', 'wood_barricade');
    expect(woodBarricade).not.toBeNull();
    expect(woodBarricade?.kind).toBe('wood_barricade');
    expect(woodBarricade?.hp).toBe(BALANCE.STRUCTURES.WOOD_BARRICADE.MAX_HP);

    // Move o jogador para construir a próxima estrutura sem sobrepor
    sim.step(50, {
      p1: { seq: 1, dx: 0, dy: 1, aimMode: 'manual', aimX: 0, aimY: 1, firing: false },
    });

    // 2. Constrói Barricada Reforçada (custo: 2 Madeira + 2 Sucata)
    const scrapBarricade = sim.buildPlayerStructure('p1', 'scrap_barricade');
    expect(scrapBarricade).not.toBeNull();
    expect(scrapBarricade?.kind).toBe('scrap_barricade');
    expect(scrapBarricade?.hp).toBe(BALANCE.STRUCTURES.SCRAP_BARRICADE.MAX_HP);

    // Move o jogador para outra direção para plantar armadilha
    sim.step(50, {
      p1: { seq: 2, dx: -1, dy: 0, aimMode: 'manual', aimX: -1, aimY: 0, firing: false },
    });

    // 3. Constrói Armadilha de Espinhos (custo: 1 Madeira + 1 Sucata)
    const spikeTrap = sim.buildPlayerStructure('p1', 'spike_trap');
    expect(spikeTrap).not.toBeNull();
    expect(spikeTrap?.kind).toBe('spike_trap');

    const snap = sim.getSnapshot();
    expect(snap.structuresBuilt).toBe(3);
    expect(snap.structures?.length).toBe(3);

    const p1 = snap.players.find((p) => p.id === 'p1')!;
    // Recursos iniciais (4M, 2S) + (10M, 10S) = (14M, 12S) - (2M + 2M + 1M = 5M) e (2S + 1S = 3S)
    expect(p1.wood).toBe(14 - 5);
    expect(p1.scrap).toBe(12 - 3);
  });

  it('barricadas sólidas bloqueiam movimento físico mas permitem disparos por cima, e zumbis atacam até destruí-las', () => {
    const sim = new Simulation({
      seed: 4003,
      enableAutoSpawn: false,
      startingWeapon: 'pistol',
    });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();

    sim.addPlayer('p1', { x: 2000, y: 2000 });
    const built = sim.buildPlayerStructure('p1', 'wood_barricade')!;
    expect(built).not.toBeNull();
    // Barricada criada em (2052, 2000) com raio 20

    // Posiciona um zumbi logo à direita da barricada (encostando nela)
    const zombie = sim.spawnZombie('common', { x: built.x + built.radius + 14, y: 2000 })!;
    expect(zombie).not.toBeNull();

    // Avança ticks sem atirar: o zumbi não consegue atravessar a barricada para alcançar x=2000
    // e ataca a barricada periodicamente a cada 800ms
    for (let i = 1; i <= 20; i += 1) {
      sim.step(50, {
        p1: { seq: i, dx: 0, dy: 0, aimMode: 'manual', aimX: 1, aimY: 0, firing: false },
      });
    }

    const snapAfter1Sec = sim.getSnapshot();
    const structAfter1Sec = snapAfter1Sec.structures![0];
    const zAfter1Sec = snapAfter1Sec.zombies[0];
    // O zumbi foi bloqueado pela barricada (permanece à direita do centro da barricada)
    expect(zAfter1Sec.x).toBeGreaterThan(built.x + built.radius);
    // A barricada sofreu dano de contato do zumbi
    expect(structAfter1Sec.hp).toBeLessThan(structAfter1Sec.maxHp);

    // Repara a barricada com repairNearestStructure (gasta 1 Madeira e restaura +90 HP)
    const hpBeforeRepair = structAfter1Sec.hp;
    const repaired = sim.repairNearestStructure('p1');
    expect(repaired).toBe(true);
    const snapAfterRepair = sim.getSnapshot();
    expect(snapAfterRepair.structures![0].hp).toBeGreaterThan(hpBeforeRepair);
  });

  it('armadilha de espinhos causa lentidão e dano periódico aos zumbis sem bloquear o caminho', () => {
    const sim = new Simulation({ seed: 4004, enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();

    sim.addPlayer('p1', { x: 2000, y: 2000 });
    const trap = sim.buildPlayerStructure('p1', 'spike_trap')!;
    expect(trap).not.toBeNull();

    // Spawna um zumbi exatamente sobre a armadilha de espinhos
    const z = sim.spawnZombie('common', { x: trap.x, y: trap.y })!;
    const initialZombieHp = z.hp;

    // Avança 1 tick: armadilha aciona imediatamente causando dano ao zumbi e consumindo durabilidade
    sim.step(50, {});
    const snap = sim.getSnapshot();
    expect(snap.zombies[0].hp).toBe(
      initialZombieHp - BALANCE.STRUCTURES.SPIKE_TRAP.DAMAGE_PER_TICK
    );
    expect(snap.structures![0].hp).toBe(
      trap.maxHp - BALANCE.STRUCTURES.SPIKE_TRAP.SELF_DAMAGE_PER_TICK
    );
  });

  it('usa Kit Médico (usePlayerMedkit) para restaurar +45 HP respeitando o limite de maxHp', () => {
    const sim = new Simulation({ seed: 4005, enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();

    sim.addPlayer('p1', { x: 2000, y: 2000 });
    // Com vida cheia (100/100), usar kit médico retorna false e não gasta o item
    expect(sim.usePlayerMedkit('p1')).toBe(false);

    sim.setPlayerHp('p1', 40);
    sim.consumeEvents();

    const healed = sim.usePlayerMedkit('p1');
    expect(healed).toBe(true);

    const snap = sim.getSnapshot();
    const p1 = snap.players.find((p) => p.id === 'p1')!;
    expect(p1.hp).toBe(40 + BALANCE.SURVIVAL.MEDKIT_HEAL_HP);
    expect(p1.medkits).toBe(0);

    const events = sim.consumeEvents();
    expect(events.some((e) => e.type === 'player_healed')).toBe(true);
  });
});
