import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  Simulation,
  computeSpawnRatePerSec,
  getZombieStats,
} from '../src/index.js';

describe('Simulation — Etapa 3: Zumbis, Spawn, Colisões, Combate Automático, Vida, Morte e Fim de Jogo', () => {
  const tickMs = BALANCE.SIMULATION.TICK_DT_MS; // 50 ms

  it('configura corretamente os 3 tipos de zumbis (comum, rápido, brutamontes) e persegue o jogador vivo mais próximo', () => {
    expect(getZombieStats('common')).toMatchObject({
      hp: 30,
      speedPxPerSec: 70,
      contactDamage: 8,
      xp: 1,
    });
    expect(getZombieStats('fast')).toMatchObject({
      hp: 18,
      speedPxPerSec: 120,
      contactDamage: 5,
      xp: 1,
    });
    expect(getZombieStats('brute')).toMatchObject({
      hp: 150,
      speedPxPerSec: 45,
      contactDamage: 20,
      xp: 5,
    });

    const sim = new Simulation({ seed: 701, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 1000, y: 1000 });
    sim.addPlayer('p2', { x: 3000, y: 3000 });

    // Zumbi nasce mais perto de p2 (em 2500, 3000) fora do alcance da pistola (500 px)
    sim.spawnZombie('fast', { x: 2500, y: 3000 });

    sim.step(tickMs);
    let z = sim.getSnapshot().zombies[0];
    // Deve ter se movido para a direita (+X) em direção a p2 (120 px/s * 0.05s = 6 px)
    expect(z.x).toBeCloseTo(2506, 4);
    expect(z.y).toBeCloseTo(3000, 4);

    // Se p2 morrer, o zumbi passa a perseguir p1 (que está vivo em 1000, 1000)
    sim.setPlayerHp('p2', 0);
    const prevX = z.x;
    sim.step(tickMs);
    z = sim.getSnapshot().zombies[0];
    expect(z.x).toBeLessThan(prevX);

    // Garante que múltiplos zumbis simultâneos (índices 0, 1, 2...) perseguem o jogador no mesmo tick (sem exaurir iterador)
    sim.spawnZombie('common', { x: 1600, y: 1000 });
    sim.spawnZombie('brute', { x: 1000, y: 1600 });
    const beforeMulti = sim.getSnapshot().zombies.map((zm) => ({
      id: zm.id,
      dist: Math.hypot(zm.x - 1000, zm.y - 1000),
    }));
    expect(beforeMulti.length).toBe(3);

    sim.step(tickMs);
    const afterMulti = sim.getSnapshot().zombies;
    for (const zm of afterMulti) {
      const prev = beforeMulti.find((b) => b.id === zm.id)!;
      const newDist = Math.hypot(zm.x - 1000, zm.y - 1000);
      expect(newDist).toBeLessThan(prev.dist);
      expect(Math.hypot(zm.vx, zm.vy)).toBeGreaterThan(0);
    }
  });

  it('escala a taxa de spawn em +10% por minuto e pelo número de jogadores, nascendo em anel fora da tela e respeitando máximo de 150 vivos', () => {
    expect(computeSpawnRatePerSec(0, 1)).toBeCloseTo(0.8, 5);
    expect(computeSpawnRatePerSec(60_000, 1)).toBeCloseTo(0.8 * 1.1, 5);
    expect(computeSpawnRatePerSec(120_000, 1)).toBeCloseTo(0.8 * 1.2, 5);
    expect(computeSpawnRatePerSec(0, 2)).toBeCloseTo(1.6, 5);

    const sim = new Simulation({ seed: 702, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 2000, y: 2000 });

    // Verifica que zumbis nascidos em anel ficam fora da tela (>= RING_MIN_RADIUS) e dentro da arena
    for (let i = 0; i < 25; i += 1) {
      const z = sim.spawnZombie();
      expect(z).not.toBeNull();
      if (z) {
        const dist = Math.hypot(z.x - 2000, z.y - 2000);
        expect(dist).toBeGreaterThanOrEqual(BALANCE.SPAWN.RING_MIN_RADIUS * 0.95);
        expect(dist).toBeLessThanOrEqual(BALANCE.SPAWN.RING_MAX_RADIUS + 1);
        expect(z.x).toBeGreaterThanOrEqual(z.radius);
        expect(z.x).toBeLessThanOrEqual(BALANCE.MAP.WIDTH - z.radius);
      }
    }

    // Verifica teto máximo de 150 zumbis vivos
    for (let i = 0; i < 200; i += 1) {
      sim.spawnZombie('common', { x: 500 + (i % 20) * 30, y: 500 + Math.floor(i / 20) * 30 });
    }
    expect(sim.getSnapshot().zombies.length).toBe(BALANCE.SPAWN.MAX_ALIVE);
    expect(sim.spawnZombie('common', { x: 600, y: 600 })).toBeNull();
  });

  it('separa suavemente zumbis sobrepostos (colisão círculo com círculo)', () => {
    const sim = new Simulation({ seed: 703, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 2000, y: 2000 });

    // Dois zumbis comuns na mesma coordenada exata (dist = 0, raios = 14)
    sim.spawnZombie('common', { x: 1200, y: 2000 });
    sim.spawnZombie('common', { x: 1200, y: 2000 });

    sim.step(tickMs);
    const [z1, z2] = sim.getSnapshot().zombies;
    const distAfterOneTick = Math.hypot(z1.x - z2.x, z1.y - z2.y);
    expect(distAfterOneTick).toBeGreaterThan(0);

    // Após alguns ticks de relaxamento, os círculos se afastam ainda mais
    for (let t = 0; t < 6; t += 1) {
      sim.step(tickMs);
    }
    const [z1Later, z2Later] = sim.getSnapshot().zombies;
    const distAfterRelax = Math.hypot(z1Later.x - z2Later.x, z1Later.y - z2Later.y);
    expect(distAfterRelax).toBeGreaterThan(distAfterOneTick);
  });

  it('aplica dano de contato e respeita o intervalo de invulnerabilidade de 0,8 s (16 ticks)', () => {
    const sim = new Simulation({ seed: 704, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 2000, y: 2000 });
    sim.consumeEvents(); // Limpa player_spawned

    // Brutamontes (20 de dano, 150 HP) encostado no jogador
    sim.spawnZombie('brute', { x: 2015, y: 2000 });

    // Tick 1: causa 20 de dano de contato e ativa invulnerabilidade de 800 ms
    sim.step(tickMs);
    let p = sim.getSnapshot().players[0];
    expect(p.hp).toBe(80);
    expect(p.invulnMs).toBe(800);

    const eventsTick1 = sim.consumeEvents();
    const playerHitEv = eventsTick1.find((e) => e.type === 'player_hit');
    expect(playerHitEv).toBeDefined();
    expect(playerHitEv?.type === 'player_hit' && playerHitEv.damage).toBe(20);

    // Nos próximos 15 ticks (750 ms), mesmo em contato contínuo, não sofre novo dano
    for (let i = 0; i < 15; i += 1) {
      sim.step(tickMs);
      p = sim.getSnapshot().players[0];
      expect(p.hp).toBe(80);
    }
    expect(p.invulnMs).toBe(50);

    // No 16º tick após o primeiro golpe (800 ms completos), invulnMs zera e sofre novo dano de contato
    sim.step(tickMs);
    p = sim.getSnapshot().players[0];
    expect(p.hp).toBe(60);
    expect(p.invulnMs).toBe(800);
  });

  it('dispara automaticamente no zumbi mais próximo dentro do alcance (320 px), simula projétil e abate com 3 tiros (30 HP / 12 dano)', () => {
    const sim = new Simulation({ seed: 705, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 2000, y: 2000 });
    sim.consumeEvents();

    // Zumbi fora do alcance (450 px > 320 px): não deve disparar
    sim.spawnZombie('common', { x: 2450, y: 2000 });
    sim.step(tickMs);
    expect(sim.consumeEvents().some((e) => e.type === 'fire')).toBe(false);

    // Adiciona um zumbi comum dentro do alcance (a 120 px de distância)
    sim.spawnZombie('common', { x: 2120, y: 2000 });

    let fireEventsCount = 0;
    let hitEventsCount = 0;
    let killedEventSeen = false;

    // Roda 25 ticks (1,25 s) — suficiente para 3 disparos a 3 tiros/s e voo dos projéteis
    for (let t = 0; t < 25; t += 1) {
      sim.step(tickMs);
      for (const ev of sim.consumeEvents()) {
        if (ev.type === 'fire') {
          fireEventsCount += 1;
        } else if (ev.type === 'hit') {
          hitEventsCount += 1;
          if (ev.killed) {
            killedEventSeen = true;
          }
        }
      }
    }

    expect(fireEventsCount).toBeGreaterThanOrEqual(3);
    expect(hitEventsCount).toBeGreaterThanOrEqual(3);
    expect(killedEventSeen).toBe(true);

    const snap = sim.getSnapshot();
    expect(snap.kills).toBe(1);
    expect(snap.players[0].kills).toBe(1);
    expect(snap.xp).toBe(1);
  });

  it('continua a partida se um jogador morrer no coop e encerra (gameOver = true) quando todos morrem', () => {
    const sim = new Simulation({ seed: 706, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 1500, y: 2000 });
    sim.addPlayer('p2', { x: 2500, y: 2000 });

    // Deixa p1 com 10 de vida e encosta um brutamontes (20 de dano)
    sim.setPlayerHp('p1', 10);
    sim.spawnZombie('brute', { x: 1510, y: 2000 });

    sim.step(tickMs);
    let snap = sim.getSnapshot();
    const p1 = snap.players.find((p) => p.id === 'p1')!;
    const p2 = snap.players.find((p) => p.id === 'p2')!;

    expect(p1.alive).toBe(false);
    expect(p1.hp).toBe(0);
    expect(p2.alive).toBe(true);
    expect(snap.gameOver).toBe(false); // O outro jogador continua vivo

    // Agora p2 também morre
    sim.setPlayerHp('p2', 5);
    sim.spawnZombie('common', { x: 2510, y: 2000 });
    sim.step(tickMs);

    snap = sim.getSnapshot();
    expect(snap.gameOver).toBe(true);

    // Após gameOver, chamar step() não avança mais o tick nem o tempo de sobrevivência
    const frozenTick = snap.tick;
    const frozenElapsed = snap.elapsedMs;
    sim.step(tickMs, { p2: { seq: 99, dx: 1, dy: 0 } });
    expect(sim.getSnapshot().tick).toBe(frozenTick);
    expect(sim.getSnapshot().elapsedMs).toBe(frozenElapsed);
  });
});
