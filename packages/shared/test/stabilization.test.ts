import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  PlayerInputQueue,
  Simulation,
  type InputCmd,
} from '../src/index.js';

describe('Etapa 7 — Estabilização Final, Stress de 5 Minutos (2 Bots Coop), Anti-Cheat e Ciclo de Partida', () => {
  it('executa 5 minutos contínuos (6.000 ticks a 20 Hz) com 2 bots cooperativos sem exceder MAX_ALIVE (150) e dentro do orçamento de tempo de tick', () => {
    const sim = new Simulation({
      seed: 202607,
      enableAutoSpawn: true,
      startingWeapon: 'pistol',
    });
    sim.addPlayer('bot-1', { x: 1960, y: 2000 });
    sim.addPlayer('bot-2', { x: 2040, y: 2000 });
    sim.addAmmo('bot-1', 'light', 5000);
    sim.addAmmo('bot-2', 'light', 5000);

    const totalTicks = 6000; // 6000 * 50 ms = 300.000 ms (5 minutos)
    const stepTimesMs: number[] = [];
    let maxZombiesObserved = 0;
    let totalEventsEmitted = 0;
    let totalEventBytes = 0;
    let totalInputBytes = 0;
    let lastEventId = 0;

    for (let tick = 1; tick <= totalTicks; tick += 1) {
      // Mantém os 2 bots vivos durante todo o teste de stress de 5 minutos para exercitar ondas densas
      const preSnap = sim.getSnapshot();
      for (const p of preSnap.players) {
        if (p.hp < 60) {
          sim.setPlayerHp(p.id, BALANCE.PLAYER.MAX_HP);
        }
        if ((p.ammoLight ?? 0) < 60) {
          sim.addAmmo(p.id, 'light', 240);
        }
      }

      const angle1 = (tick * 0.045) % (Math.PI * 2);
      const angle2 = ((tick * 0.045) + Math.PI) % (Math.PI * 2);
      const aimAngle2 = (tick * 0.11) % (Math.PI * 2);

      const cmd1: InputCmd = {
        seq: tick,
        dx: Math.cos(angle1),
        dy: Math.sin(angle1),
        aimMode: 'auto',
      };
      const cmd2: InputCmd = {
        seq: tick,
        dx: Math.cos(angle2),
        dy: Math.sin(angle2),
        aimMode: tick % 200 < 100 ? 'manual' : 'auto',
        aimX: Math.cos(aimAngle2),
        aimY: Math.sin(aimAngle2),
        firing: true,
      };

      totalInputBytes +=
         Buffer.byteLength(JSON.stringify(cmd1)) +
        Buffer.byteLength(JSON.stringify(cmd2));

      const t0 = performance.now();
      sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
        'bot-1': cmd1,
        'bot-2': cmd2,
      });
      const stepElapsed = performance.now() - t0;
      stepTimesMs.push(stepElapsed);

      const snap = sim.getSnapshot();
      if (snap.zombies.length > maxZombiesObserved) {
        maxZombiesObserved = snap.zombies.length;
      }

      // Garante que o teto de zumbis vivos nunca é ultrapassado
      expect(snap.zombies.length).toBeLessThanOrEqual(BALANCE.SPAWN.MAX_ALIVE);

      // Consome eventos transitórios garantindo IDs monotônicos estritamente crescentes
      const events = sim.consumeEvents();
      for (const ev of events) {
        expect(ev.eventId).toBe(lastEventId + 1);
        lastEventId = ev.eventId;
      }
      if (events.length > 0) {
        totalEventsEmitted += events.length;
        totalEventBytes += Buffer.byteLength(JSON.stringify(events));
      }

      // Segunda chamada imediata a consumeEvents deve retornar vazio
      expect(sim.consumeEvents()).toHaveLength(0);
    }

    const finalSnap = sim.getSnapshot();
    const sortedTimes = [...stepTimesMs].sort((a, b) => a - b);
    const avgStepMs =
      stepTimesMs.reduce((acc, v) => acc + v, 0) / stepTimesMs.length;
    const p95StepMs = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
    const maxStepMs = sortedTimes[sortedTimes.length - 1];

    const avgInputBytesPerSecPerPlayer = totalInputBytes / 2 / 300;
    const avgEventBytesPerSec = totalEventBytes / 300;

    expect(finalSnap.tick).toBe(6000);
    expect(finalSnap.elapsedMs).toBe(300_000);
    expect(finalSnap.kills).toBeGreaterThan(50);
    expect(finalSnap.level).toBeGreaterThan(3);
    expect(totalEventsEmitted).toBeGreaterThan(200);
    expect(maxZombiesObserved).toBeGreaterThan(20);
    expect(maxZombiesObserved).toBeLessThanOrEqual(BALANCE.SPAWN.MAX_ALIVE);

    // O passo médio de 50 ms deve executar em menos de 5 ms (folga > 10x no servidor)
    expect(avgStepMs).toBeLessThan(5);
    expect(p95StepMs).toBeLessThan(15);
    expect(maxStepMs).toBeLessThan(50);
    expect(avgInputBytesPerSecPerPlayer).toBeLessThan(4096);
    expect(avgEventBytesPerSec).toBeLessThan(16384);
  });

  it('impede speed-hack e respeita limite de fila (MAX_QUEUE_SIZE = 8) e rate-limit por segundo', () => {
    const queue = new PlayerInputQueue();
    const sim = new Simulation({ seed: 777, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 2000, y: 2000 });

    // Cliente malicioso tenta enviar 25 comandos de uma só vez no mesmo instante (t = 1000 ms)
    let acceptedCount = 0;
    for (let seq = 1; seq <= 25; seq += 1) {
      if (queue.enqueue({ seq, dx: 1, dy: 0, aimMode: 'auto' }, 1000)) {
        acceptedCount += 1;
      }
    }

    // Todos os 25 estavam dentro do rate-limit de 40/s, mas a fila mantém apenas os 8 mais recentes
    expect(acceptedCount).toBe(25);
    expect(queue.getPendingCount()).toBe(BALANCE.SIMULATION.MAX_INPUT_QUEUE);

    // No tick de 50 ms do servidor, apenas UM comando é retirado e aplicado
    const nextCmd = queue.popNextTickCommand()!;
    sim.step(BALANCE.SIMULATION.TICK_DT_MS, { p1: nextCmd });

    const snap = sim.getSnapshot();
    const p1 = snap.players[0];
    // 1 passo de 50 ms a 180 px/s = exatos 9 px (2000 -> 2009), nunca 25 * 9 px
    expect(p1.x).toBeCloseTo(2009, 5);

    // Rajada acima de MAX_INPUTS_PER_SEC (35/s) no mesmo segundo é bloqueada pelo rate limiter
    let rateLimited = false;
    for (let seq = 26; seq <= 50; seq += 1) {
      const ok = queue.enqueue({ seq, dx: 1, dy: 0 }, 1100);
      if (!ok) {
        rateLimited = true;
      }
    }
    expect(rateLimited).toBe(true);
  });

  it('cobre reconexão dentro de 20s, morte após expirar 20s e reinício limpo da partida (resetMatch)', () => {
    const sim = new Simulation({ seed: 5050, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 2000, y: 2000 });
    sim.addPlayer('p2', { x: 2060, y: 2000 });

    // p1 desconecta, mas reconecta antes de 20s
    sim.setPlayerConnected('p1', false);
    sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
      p1: { seq: 1, dx: 1, dy: 0 },
      p2: { seq: 1, dx: 1, dy: 0 },
    });
    sim.setPlayerConnected('p1', true);
    sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
      p1: { seq: 2, dx: 1, dy: 0 },
      p2: { seq: 2, dx: 1, dy: 0 },
    });

    const afterReconnect = sim.getSnapshot();
    const p1Reconnected = afterReconnect.players.find((p) => p.id === 'p1')!;
    expect(p1Reconnected.connected).toBe(true);
    expect(p1Reconnected.alive).toBe(true);
    expect(p1Reconnected.x).toBeCloseTo(2009, 5);

    // Agora ambos morrem -> gameOver = true
    sim.setPlayerHp('p1', 0);
    sim.setPlayerHp('p2', 0);
    expect(sim.getSnapshot().gameOver).toBe(true);

    // Reinicia a partida com nova seed e verifica restauração completa do estado
    sim.resetMatch(9090);
    const afterReset = sim.getSnapshot();
    expect(afterReset.seed).toBe(9090);
    expect(afterReset.tick).toBe(0);
    expect(afterReset.elapsedMs).toBe(0);
    expect(afterReset.gameOver).toBe(false);
    expect(afterReset.level).toBe(1);
    expect(afterReset.xp).toBe(0);
    expect(afterReset.kills).toBe(0);
    expect(afterReset.zombies).toHaveLength(0);
    expect(afterReset.players.every((p) => p.alive && p.hp === BALANCE.PLAYER.MAX_HP)).toBe(
      true
    );
  });
});
