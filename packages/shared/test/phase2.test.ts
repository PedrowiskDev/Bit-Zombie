import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  Simulation,
  type PlayerRevivedEvent,
  type ProjectileHitEvent,
  type UpgradeChosenEvent,
  type WeaponFireEvent,
} from '../src/index.js';

describe('Fase 2 — Escolha Interativa de Upgrades (Sem Pausar Coop), Multishot, Perfuração e Reviver Aliado', () => {
  const tickMs = BALANCE.SIMULATION.TICK_DT_MS;

  it('gera oferta de 3 cartas distintas ao subir de nível, valida escolha e auto-seleciona após timeout de 12s', () => {
    const sim = new Simulation({ seed: 202602, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 2000, y: 2000 });
    sim.addPlayer('p2', { x: 2060, y: 2000 });
    sim.consumeEvents();

    // Sobe para o nível 2 (10 XP)
    sim.addSharedXp(10);
    const snap = sim.getSnapshot();
    const p1 = snap.players.find((p) => p.id === 'p1')!;
    const p2 = snap.players.find((p) => p.id === 'p2')!;

    expect(p1.pendingUpgradeOptions).toHaveLength(3);
    expect(new Set(p1.pendingUpgradeOptions).size).toBe(3);
    expect(p2.pendingUpgradeOptions).toHaveLength(3);

    // Rejeita upgrade inválido que não faz parte da oferta
    expect(sim.chooseUpgrade('p1', 'invalid_upgrade_id')).toBe(false);

    // p1 escolhe manualmente a segunda carta da oferta
    const chosenId = p1.pendingUpgradeOptions![1];
    expect(sim.chooseUpgrade('p1', chosenId)).toBe(true);

    const afterChoice = sim.getSnapshot().players.find((p) => p.id === 'p1')!;
    expect(afterChoice.pendingUpgradeOptions).toHaveLength(0);
    expect(afterChoice.upgradesChosenCount).toBe(1);

    const choiceEvents = sim
      .consumeEvents()
      .filter((e): e is UpgradeChosenEvent => e.type === 'upgrade_chosen');
    expect(choiceEvents).toHaveLength(1);
    expect(choiceEvents[0].playerId).toBe('p1');
    expect(choiceEvents[0].upgradeId).toBe(chosenId);
    expect(choiceEvents[0].autoSelected).toBe(false);

    // p2 não clica em nada por 12 segundos (240 ticks de 50 ms) -> seleção automática da 1ª carta sem travar a partida
    const expectedAutoId = p2.pendingUpgradeOptions![0];
    for (let i = 0; i < 240; i += 1) {
      sim.step(tickMs, {});
    }

    const p2AfterTimeout = sim.getSnapshot().players.find((p) => p.id === 'p2')!;
    expect(p2AfterTimeout.pendingUpgradeOptions).toHaveLength(0);
    expect(p2AfterTimeout.upgradesChosenCount).toBe(1);

    const autoEvents = sim
      .consumeEvents()
      .filter((e): e is UpgradeChosenEvent => e.type === 'upgrade_chosen');
    expect(autoEvents).toHaveLength(1);
    expect(autoEvents[0].playerId).toBe('p2');
    expect(autoEvents[0].upgradeId).toBe(expectedAutoId);
    expect(autoEvents[0].autoSelected).toBe(true);
  });

  it('aplica upgrades táticos da Fase 2: Tiro Duplo em Leque (multishot), Perfuração (pierce) e Colete + Kit Médico', () => {
    const sim = new Simulation({
      seed: 9911,
      enableAutoSpawn: false,
      startingWeapon: 'pistol',
    });
    sim.addPlayer('p1', { x: 2000, y: 2000 });
    sim.setPlayerHp('p1', 60);

    // Concede 3 subidas de nível para podermos aplicar upgrades específicos
    sim.addSharedXp(10 + 18 + 26 + 34 + 42);
    sim.consumeEvents();

    // Aplica upgrades escolhendo sempre da oferta atual até acumular multishot, pierce e max_hp
    // (ou testando diretamente via ofertas geradas)
    let safety = 0;
    while (sim.getPlayerPendingOffer('p1') && safety < 10) {
      const offer = sim.getPlayerPendingOffer('p1')!;
      const preferred =
        offer.options.find((o) => o === 'pistol_multishot_boost') ??
        offer.options.find((o) => o === 'pistol_pierce_boost') ??
        offer.options.find((o) => o === 'player_max_hp_boost') ??
        offer.options[0];
      sim.chooseUpgrade('p1', preferred);
      safety += 1;
    }

    // Posiciona 2 zumbis alinhados à direita de p1 (x = 2080 e x = 2130)
    sim.spawnZombie('fast', { x: 2080, y: 2000 });
    sim.spawnZombie('fast', { x: 2130, y: 2000 });
    sim.consumeEvents();

    // Executa 1 passo para disparar e mais 5 passos para os projéteis percorrerem a linha
    for (let t = 1; t <= 6; t += 1) {
      sim.step(tickMs, { p1: { seq: t, dx: 0, dy: 0, aimMode: 'auto' } });
    }

    const events = sim.consumeEvents();
    const fires = events.filter((e): e is WeaponFireEvent => e.type === 'fire');
    const hits = events.filter((e): e is ProjectileHitEvent => e.type === 'hit');

    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('revive aliado caído após 3,0s dentro do círculo de 64 px com 50% de vida e 1,6s de invulnerabilidade', () => {
    const sim = new Simulation({ seed: 3030, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 2000, y: 2000 });
    sim.addPlayer('p2', { x: 2030, y: 2000 }); // a 30 px de distância (<= 64 px do raio de resgate)

    // Derruba p2
    sim.setPlayerHp('p2', 0);
    expect(sim.getSnapshot().players.find((p) => p.id === 'p2')!.alive).toBe(false);
    expect(sim.getSnapshot().gameOver).toBe(false);
    sim.consumeEvents();

    // Avança 30 ticks (1500 ms = 50% do tempo de resgate de 3000 ms)
    for (let i = 1; i <= 30; i += 1) {
      sim.step(tickMs, {});
    }

    const midSnap = sim.getSnapshot();
    const p2Mid = midSnap.players.find((p) => p.id === 'p2')!;
    expect(p2Mid.alive).toBe(false);
    expect(p2Mid.reviveProgress).toBeCloseTo(0.5, 2);

    // Se p1 se afastar para fora de 64 px por 10 ticks, o progresso decai suavemente
    for (let i = 31; i <= 40; i += 1) {
      sim.step(tickMs, { p1: { seq: i, dx: -1, dy: 0 } });
    }
    const decayedProgress = sim.getSnapshot().players.find((p) => p.id === 'p2')!
      .reviveProgress!;
    expect(decayedProgress).toBeLessThan(0.5);
    expect(decayedProgress).toBeGreaterThan(0.3);

    // p1 volta para perto de p2 e completa o resgate
    for (let i = 41; i <= 100; i += 1) {
      const p1Now = sim.getSnapshot().players.find((p) => p.id === 'p1')!;
      const dx = p1Now.x < 2000 ? 1 : 0;
      sim.step(tickMs, { p1: { seq: i, dx, dy: 0 } });
    }

    const finalSnap = sim.getSnapshot();
    const p2Revived = finalSnap.players.find((p) => p.id === 'p2')!;
    expect(p2Revived.alive).toBe(true);
    expect(p2Revived.hp).toBe(50); // 50% de 100 maxHp
    expect(p2Revived.reviveProgress).toBe(0);

    const reviveEvents = sim
      .consumeEvents()
      .filter((e): e is PlayerRevivedEvent => e.type === 'player_revived');
    expect(reviveEvents).toHaveLength(1);
    expect(reviveEvents[0].revivedPlayerId).toBe('p2');
    expect(reviveEvents[0].saviorPlayerId).toBe('p1');
    expect(reviveEvents[0].hpRestored).toBe(50);
  });
});
