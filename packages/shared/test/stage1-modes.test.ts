import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  Simulation,
  computeRoundThreatBudget,
} from '../src/index.js';

describe('Etapa 1 — Separação dos dois modos (Rodadas vs Exploração e Abrigo)', () => {
  it('gera exatamente a mesma geografia base (props) nos dois modos quando iniciados com a mesma seed', () => {
    const seed = 777123;
    const simRounds = new Simulation({ seed, gameMode: 'rounds' });
    const simExploration = new Simulation({ seed, gameMode: 'exploration' });

    const snapRounds = simRounds.getSnapshot();
    const snapExploration = simExploration.getSnapshot();

    expect(snapRounds.gameMode).toBe('rounds');
    expect(snapExploration.gameMode).toBe('exploration');
    expect(snapRounds.seed).toBe(seed);
    expect(snapExploration.seed).toBe(seed);
    expect(snapRounds.props.length).toBeGreaterThan(20);
    expect(snapRounds.props).toEqual(snapExploration.props);
  });

  it('Modo 1 (Sobrevivência por Rodadas): conclui rodada finita, abre intervalo de 25s e avança quando todos os jogadores vivos concordam', () => {
    const sim = new Simulation({ seed: 4242, gameMode: 'rounds' });
    sim.addPlayer('p1', { x: 2000, y: 2000 }, 0);
    sim.addPlayer('p2', { x: 2040, y: 2000 }, 1);

    // Passo 1 inicia a Rodada 1 e gera o primeiro zumbi da fila
    sim.step(BALANCE.SIMULATION.TICK_DT_MS, {});
    let snap = sim.getSnapshot();
    expect(snap.roundsState.roundNumber).toBe(1);
    expect(snap.roundsState.roundPhase).toBe('active');
    const totalRound1 = snap.roundsState.roundTotalZombies;
    expect(totalRound1).toBeGreaterThanOrEqual(8);

    // Avança ticks suficientes para nascerem todos os zumbis da Rodada 1, posicionando jogadores perto para abatê-los
    for (let i = 0; i < 450; i += 1) {
      if (i === 0) {
        sim.addSharedXp(1500);
      }
      const cur = sim.getSnapshot();
      const firstZombie = cur.zombies[0];
      if (firstZombie) {
        const p1 = cur.players.find((p) => p.id === 'p1')!;
        const dx = firstZombie.x - p1.x;
        const dy = firstZombie.y - p1.y;
        const dist = Math.hypot(dx, dy) || 1;
        const moveX = dist > 220 ? dx / dist : 0;
        const moveY = dist > 220 ? dy / dist : 0;
        sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
          p1: { seq: i + 1, dx: moveX, dy: moveY, aimMode: 'auto' },
          p2: { seq: i + 1, dx: moveX, dy: moveY, aimMode: 'auto' },
        });
      } else {
        sim.step(BALANCE.SIMULATION.TICK_DT_MS, {});
      }

      snap = sim.getSnapshot();
      if (snap.roundsState.roundPhase === 'intermission') {
        break;
      }
    }

    expect(snap.roundsState.roundPhase).toBe('intermission');
    expect(snap.roundsState.roundsCompleted).toBe(1);
    expect(snap.roundsState.roundRemainingZombies).toBe(0);
    expect(snap.roundsState.intermissionRemainingMs).toBe(
      BALANCE.ROUNDS.INTERMISSION_DURATION_MS
    );

    // Durante o intervalo de 25s, NENHUM zumbi de exploração deve nascer no Modo 1
    for (let i = 0; i < 20; i += 1) {
      sim.step(BALANCE.SIMULATION.TICK_DT_MS, {});
    }
    snap = sim.getSnapshot();
    expect(snap.zombies.length).toBe(0);
    expect(snap.roundsState.roundPhase).toBe('intermission');

    // Apenas p1 pede para antecipar: ainda aguarda p2 porque ambos estão vivos
    expect(sim.requestSkipRoundIntermission('p1')).toBe(true);
    snap = sim.getSnapshot();
    expect(snap.roundsState.roundPhase).toBe('intermission');
    expect(snap.players.find((p) => p.id === 'p1')?.readyForNextRound).toBe(true);

    // Quando p2 também concorda, a Rodada 2 inicia imediatamente
    expect(sim.requestSkipRoundIntermission('p2')).toBe(true);
    snap = sim.getSnapshot();
    expect(snap.roundsState.roundNumber).toBe(2);
    expect(snap.roundsState.roundPhase).toBe('active');
    expect(snap.players.every((p) => !p.readyForNextRound)).toBe(true);
  });

  it('Modo 1: escala orçamento de ameaça por rodada e gera rodada especial com inimigo de Elite na Rodada 5', () => {
    const b1 = computeRoundThreatBudget(1, 1);
    const b5 = computeRoundThreatBudget(5, 1);
    const b5Coop = computeRoundThreatBudget(5, 2);

    expect(b5).toBeGreaterThan(b1);
    expect(b5Coop).toBeGreaterThan(b5);

    const sim = new Simulation({ seed: 5555, gameMode: 'rounds' });
    sim.addPlayer('p1', { x: 2000, y: 2000 }, 0);
    sim.addSharedXp(5000);

    // Avança até a Rodada 5 concluindo as rodadas 1..4 e pulando os intervalos
    for (let step = 0; step < 3000; step += 1) {
      const cur = sim.getSnapshot();
      if (cur.roundsState.roundNumber === 5 && cur.zombies.some((z) => z.isElite)) {
        break;
      }
      if (cur.roundsState.roundPhase === 'intermission') {
        sim.requestSkipRoundIntermission('p1');
        continue;
      }
      const z = cur.zombies[0];
      const p1 = cur.players[0]!;
      const dx = z ? z.x - p1.x : 0;
      const dy = z ? z.y - p1.y : 0;
      const dist = Math.hypot(dx, dy) || 1;
      sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
        p1: {
          seq: step + 1,
          dx: dist > 200 ? dx / dist : 0,
          dy: dist > 200 ? dy / dist : 0,
          aimMode: 'auto',
        },
      });
    }

    const snap5 = sim.getSnapshot();
    expect(snap5.roundsState.roundNumber).toBe(5);
    expect(snap5.roundsState.isSpecialEliteRound).toBe(true);
    expect(snap5.zombies.some((z) => z.isElite)).toBe(true);
  });

  it('Modo 2 (Exploração e Abrigo): distribui zumbis ambientais iniciais, registra setores explorados e limpa estado ao reiniciar', () => {
    const sim = new Simulation({ seed: 9001, gameMode: 'exploration' });
    sim.addPlayer('p1', { x: 2000, y: 2000 }, 0);

    // Primeiro passo inicializa os zumbis ambientais pelo mapa e registra o setor inicial
    sim.step(BALANCE.SIMULATION.TICK_DT_MS, {});
    let snap = sim.getSnapshot();

    expect(snap.gameMode).toBe('exploration');
    expect(snap.zombies.length).toBe(BALANCE.EXPLORATION.INITIAL_AMBIENT_COUNT);
    expect(snap.zombies.every((z) => z.spawnSource === 'ambient')).toBe(true);
    expect(snap.explorationState.explorationPhase).toBe('exploring');
    expect(snap.explorationState.sectorsExplored).toBe(1);

    // Move o jogador por vários setores para validar registro de exploração
    for (let i = 0; i < 120; i += 1) {
      sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
        p1: { seq: i + 1, dx: 1, dy: 0 },
      });
    }
    snap = sim.getSnapshot();
    expect(snap.explorationState.sectorsExplored).toBeGreaterThanOrEqual(2);

    // Reinicia limpo e verifica que resetMatch limpa completamente o estado anterior
    sim.resetMatch(12345, 'rounds');
    sim.addPlayer('p1', { x: 2000, y: 2000 }, 0);
    const resetSnap = sim.getSnapshot();
    expect(resetSnap.gameMode).toBe('rounds');
    expect(resetSnap.seed).toBe(12345);
    expect(resetSnap.tick).toBe(0);
    expect(resetSnap.kills).toBe(0);
    expect(resetSnap.totalDamageDealt).toBe(0);
    expect(resetSnap.roundsState.roundNumber).toBe(1);
    expect(resetSnap.zombies.length).toBe(0);
  });
});
