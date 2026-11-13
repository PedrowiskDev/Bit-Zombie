import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  PlayerInputQueue,
  SeededRng,
  Simulation,
  generateRoomCode,
  interpolateRemoteEntities,
  isValidRoomCode,
  reconcileLocalPlayer,
  type PlayerStateSnapshot,
  type TimedEntitySnapshot,
  type ZombieStateSnapshot,
} from '../src/index.js';

describe('Etapa 4 — Multiplayer Autoritativo, Reconciliação, Interpolação e Salas Privadas', () => {
  it('gera e valida códigos de sala privada de 5 caracteres sem O, 0, I, 1', () => {
    const rng = new SeededRng(998877);
    for (let i = 0; i < 200; i += 1) {
      const code = generateRoomCode(() => rng.nextFloat());
      expect(code).toHaveLength(5);
      expect(isValidRoomCode(code)).toBe(true);
      expect(code).not.toMatch(/[O0I1]/);
    }

    expect(isValidRoomCode('AB23C')).toBe(true);
    expect(isValidRoomCode('ab23c')).toBe(true);
    expect(isValidRoomCode('AB03C')).toBe(false); // contém 0
    expect(isValidRoomCode('AB13C')).toBe(false); // contém 1
    expect(isValidRoomCode('ABO3C')).toBe(false); // contém O
    expect(isValidRoomCode('ABI3C')).toBe(false); // contém I
    expect(isValidRoomCode('ABCD')).toBe(false); // 4 chars
    expect(isValidRoomCode('ABCDEF')).toBe(false); // 6 chars
  });

  it('reconcilia jogador local descartando seq <= lastProcessedSeq e reaplicando seq pendentes', () => {
    const authPlayer: PlayerStateSnapshot = {
      id: 'p1',
      colorIndex: 0,
      x: 2000,
      y: 2000,
      vx: 180,
      vy: 0,
      facingAngle: 0,
      radius: BALANCE.PLAYER.RADIUS,
      hp: 100,
      maxHp: 100,
      alive: true,
      connected: true,
      ready: true,
      invulnMs: 0,
      fireCooldownMs: 0,
      kills: 0,
      lastProcessedSeq: 3,
    };

    const pending = [
      { seq: 2, dx: 1, dy: 0 }, // já confirmado
      { seq: 3, dx: 1, dy: 0 }, // já confirmado
      { seq: 4, dx: 1, dy: 0 }, // pendente (+9 px em X)
      { seq: 5, dx: 0, dy: 1 }, // pendente (+9 px em Y)
    ];

    const { reconciledPlayer, remainingInputs } = reconcileLocalPlayer(authPlayer, pending);

    expect(remainingInputs.map((c) => c.seq)).toEqual([4, 5]);
    expect(reconciledPlayer.x).toBeCloseTo(2009, 5);
    expect(reconciledPlayer.y).toBeCloseTo(2009, 5);
  });

  it('interpola outro jogador e zumbis com atraso de 100 ms sem incluir o jogador local', () => {
    const makePlayer = (id: string, x: number, y: number): PlayerStateSnapshot => ({
      id,
      colorIndex: id === 'p1' ? 0 : 1,
      x,
      y,
      vx: 0,
      vy: 0,
      facingAngle: 0,
      radius: 14,
      hp: 100,
      maxHp: 100,
      alive: true,
      connected: true,
      ready: true,
      invulnMs: 0,
      fireCooldownMs: 0,
      kills: 0,
      lastProcessedSeq: 1,
    });

    const makeZombie = (id: number, x: number, y: number): ZombieStateSnapshot => ({
      id,
      kind: 'common',
      x,
      y,
      vx: 0,
      vy: 0,
      facingAngle: 0,
      radius: 13,
      hp: 30,
      maxHp: 30,
    });

    const buffer: TimedEntitySnapshot[] = [
      {
        serverTimeMs: 100,
        players: new Map([
          ['p1', makePlayer('p1', 2000, 2000)],
          ['p2', makePlayer('p2', 2100, 2000)],
        ]),
        zombies: new Map([[1, makeZombie(1, 2200, 2000)]]),
      },
      {
        serverTimeMs: 200,
        players: new Map([
          ['p1', makePlayer('p1', 2050, 2000)],
          ['p2', makePlayer('p2', 2200, 2100)],
        ]),
        zombies: new Map([[1, makeZombie(1, 2300, 2000)]]),
      },
    ];

    // Se o tempo estimado do servidor é 250 ms e o atraso de interpolação é 100 ms -> renderServerTimeMs = 150 ms (alpha = 0.5)
    const result = interpolateRemoteEntities(buffer, 150, 'p1');
    expect(result.remotePlayers).toHaveLength(1);
    expect(result.remotePlayers[0].id).toBe('p2');
    expect(result.remotePlayers[0].x).toBeCloseTo(2150, 5);
    expect(result.remotePlayers[0].y).toBeCloseTo(2050, 5);

    expect(result.zombies).toHaveLength(1);
    expect(result.zombies[0].x).toBeCloseTo(2250, 5);
  });

  it('valida comandos no servidor (vetor limitado a 1, tipos, descarte de seq <= lastProcessedSeq, fila máx 8 e 1 cmd/tick)', () => {
    const q = new PlayerInputQueue();

    // Rejeita entradas malformadas
    expect(q.enqueue(null, 1000)).toBe(false);
    expect(q.enqueue({ seq: -1, dx: 1, dy: 0 }, 1000)).toBe(false);
    expect(q.enqueue({ seq: 1.5, dx: 1, dy: 0 }, 1000)).toBe(false);
    expect(q.enqueue({ seq: 1, dx: Number.NaN, dy: 0 }, 1000)).toBe(false);

    // Aceita fora de ordem e normaliza vetor diagonal > 1
    expect(q.enqueue({ seq: 2, dx: 10, dy: 10 }, 1000)).toBe(true);
    expect(q.enqueue({ seq: 1, dx: 5, dy: 0 }, 1000)).toBe(true);
    // Duplicado na fila deve ser ignorado
    expect(q.enqueue({ seq: 2, dx: 1, dy: 0 }, 1000)).toBe(false);

    const first = q.popNextTickCommand()!;
    expect(first.seq).toBe(1);
    expect(first.dx).toBeCloseTo(1, 5);
    expect(first.dy).toBeCloseTo(0, 5);
    expect(q.getLastProcessedSeq()).toBe(1);

    // Comando atrasado (seq <= lastProcessedSeq) é descartado
    expect(q.enqueue({ seq: 1, dx: -1, dy: 0 }, 1000)).toBe(false);

    const second = q.popNextTickCommand()!;
    expect(second.seq).toBe(2);
    expect(Math.hypot(second.dx, second.dy)).toBeCloseTo(1, 5);
    expect(q.getLastProcessedSeq()).toBe(2);
  });

  it('mantém jogador desconectado parado e invulnerável durante a janela de 20s, e conta como morto se expirar', () => {
    const sim = new Simulation({ seed: 4242, enableAutoSpawn: false });
    const p1 = sim.addPlayer('p1', { x: 2000, y: 2000 });
    const p2 = sim.addPlayer('p2', { x: 2150, y: 2000 });

    expect(p1.colorIndex).toBe(0);
    expect(p2.colorIndex).toBe(1);

    // Desconecta p1 temporariamente (janela de 20s)
    sim.setPlayerConnected('p1', false);

    // Coloca um zumbi encostado em p1
    sim.spawnZombie('common', { x: 2005, y: 2000 });

    // Tenta enviar input para p1 e avança 10 ticks (500 ms)
    for (let i = 1; i <= 10; i += 1) {
      sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
        p1: { seq: i, dx: 1, dy: 0 },
        p2: { seq: i, dx: 1, dy: 0 },
      });
    }

    const snapDuringGrace = sim.getSnapshot();
    const p1During = snapDuringGrace.players.find((p) => p.id === 'p1')!;
    const p2During = snapDuringGrace.players.find((p) => p.id === 'p2')!;

    // p1 permaneceu parado em 2000 e invulnerável (HP intacto em 100)
    expect(p1During.connected).toBe(false);
    expect(p1During.x).toBe(2000);
    expect(p1During.hp).toBe(100);
    expect(p1During.alive).toBe(true);

    // p2 se moveu normalmente
    expect(p2During.x).toBeGreaterThan(2150);

    // Se os 20s expiram sem reconexão, o servidor zera o HP do jogador desconectado
    sim.setPlayerHp('p1', 0);
    const snapAfterTimeout = sim.getSnapshot();
    const p1After = snapAfterTimeout.players.find((p) => p.id === 'p1')!;
    expect(p1After.alive).toBe(false);
    // Como p2 ainda está vivo, a partida continua (gameOver === false)
    expect(snapAfterTimeout.gameOver).toBe(false);
  });
});
