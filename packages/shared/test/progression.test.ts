import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  PlayerInputQueue,
  Simulation,
  UPGRADE_CATALOG,
  computeEffectiveWeaponStats,
  getAutomaticUpgradesForLevel,
  getXpForLevel,
  type LevelUpEvent,
  type WeaponFireEvent,
} from '../src/index.js';

describe('Etapa 5 — XP Compartilhado, Nível, Bônus Automáticos, Catálogo de Upgrades e Tiro Auto vs Manual', () => {
  const tickMs = BALANCE.SIMULATION.TICK_DT_MS;

  it('calcula XP por nível e aplica bônus automáticos alternados (+10% dano nos níveis pares, +8% cadência nos ímpares)', () => {
    expect(getXpForLevel(1)).toBe(10);
    expect(getXpForLevel(2)).toBe(18);
    expect(getXpForLevel(3)).toBe(26);

    const lv1 = computeEffectiveWeaponStats(1);
    expect(lv1.damage).toBe(12);
    expect(lv1.fireRatePerSec).toBe(3);

    // Nível 2 (par) -> +10% dano (12 * 1.1 = 13.2)
    const lv2 = computeEffectiveWeaponStats(2);
    expect(lv2.damage).toBeCloseTo(13.2, 2);
    expect(lv2.fireRatePerSec).toBeCloseTo(3, 2);

    // Nível 3 (ímpar) -> +10% dano e +8% cadência (3 * 1.08 = 3.24)
    const lv3 = computeEffectiveWeaponStats(3);
    expect(lv3.damage).toBeCloseTo(13.2, 2);
    expect(lv3.fireRatePerSec).toBeCloseTo(3.24, 2);

    // Nível 4 (par) -> +20% dano acumulado (12 * 1.2 = 14.4) e +8% cadência
    const lv4 = computeEffectiveWeaponStats(4);
    expect(lv4.damage).toBeCloseTo(14.4, 2);
    expect(lv4.fireRatePerSec).toBeCloseTo(3.24, 2);
  });

  it('mantém estrutura de catálogo de upgrades pronta para a Fase 2 e acumula modificadores', () => {
    expect(Object.keys(UPGRADE_CATALOG)).toEqual(
      expect.arrayContaining([
        'pistol_damage_boost',
        'pistol_firerate_boost',
        'pistol_range_boost',
        'pistol_proj_speed_boost',
        'player_move_speed_boost',
        'player_max_hp_boost',
      ])
    );

    const autoLv3 = getAutomaticUpgradesForLevel(3);
    expect(autoLv3).toEqual([
      { upgradeId: 'pistol_damage_boost', stacks: 1 },
      { upgradeId: 'pistol_firerate_boost', stacks: 1 },
    ]);

    const withExtraRange = computeEffectiveWeaponStats(3, [
      { upgradeId: 'pistol_range_boost', stacks: 2 },
    ]);
    expect(withExtraRange.rangePx).toBe(BALANCE.PISTOL.RANGE_PX + 70);
  });

  it('compartilha XP pela dupla na Simulation, sobe de nível e emite evento level_up com os novos atributos', () => {
    const sim = new Simulation({ seed: 5001, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 2000, y: 2000 });
    sim.addPlayer('p2', { x: 2050, y: 2000 });
    sim.consumeEvents();

    // Dois brutamontes (5 XP cada = 10 XP total -> suficiente para subir do nível 1 para o 2)
    sim.addSharedXp(5);
    expect(sim.getSnapshot().level).toBe(1);
    expect(sim.getSnapshot().xp).toBe(5);

    sim.addSharedXp(5);
    const snapLv2 = sim.getSnapshot();
    expect(snapLv2.level).toBe(2);
    expect(snapLv2.xp).toBe(0);
    expect(snapLv2.xpToNextLevel).toBe(18);
    expect(snapLv2.weaponDamage).toBeCloseTo(13.2, 2);
    expect(snapLv2.lastLevelBonusLabel).toContain('+10% Dano');

    const events = sim.consumeEvents();
    const lvUpEv = events.find((e): e is LevelUpEvent => e.type === 'level_up');
    expect(lvUpEv).toBeDefined();
    expect(lvUpEv?.newLevel).toBe(2);
    expect(lvUpEv?.bonusKind).toBe('damage');
  });

  it('permite alternar entre tiro automático (auto) e tiro manual pelo lado direito (manual)', () => {
    const sim = new Simulation({ seed: 5002, enableAutoSpawn: false });
    sim.addPlayer('p1', { x: 2000, y: 2000 });
    // Zumbi comum à direita (a 120 px de distância)
    sim.spawnZombie('common', { x: 2120, y: 2000 });
    sim.consumeEvents();

    // 1. Modo Manual SEM pressionar gatilho (firing: false): não deve disparar mesmo com zumbi no alcance
    sim.step(tickMs, {
      p1: {
        seq: 1,
        dx: 0,
        dy: 0,
        aimMode: 'manual',
        aimX: 0,
        aimY: -1,
        firing: false,
      },
    });
    const evNoFire = sim.consumeEvents().filter((e) => e.type === 'fire');
    expect(evNoFire).toHaveLength(0);
    // Mas a direção de mira do jogador (facingAngle) deve apontar para cima (-PI/2)
    expect(sim.getSnapshot().players[0].facingAngle).toBeCloseTo(-Math.PI / 2, 4);

    // 2. Modo Manual COM gatilho acionado (firing: true) apontando para cima (0, -1): dispara na direção manual
    sim.step(tickMs, {
      p1: {
        seq: 2,
        dx: 0,
        dy: 0,
        aimMode: 'manual',
        aimX: 0,
        aimY: -1,
        firing: true,
      },
    });
    const evManualFire = sim
      .consumeEvents()
      .filter((e): e is WeaponFireEvent => e.type === 'fire');
    expect(evManualFire).toHaveLength(1);
    expect(evManualFire[0].targetZombieId).toBe(-1);
    expect(evManualFire[0].dirX).toBeCloseTo(0, 4);
    expect(evManualFire[0].dirY).toBeCloseTo(-1, 4);

    // 3. Avança ticks até zerar cooldown da pistola (7 ticks = 350 ms > 333.3 ms) e volta para modo Automático ('auto')
    for (let i = 3; i <= 9; i += 1) {
      sim.step(tickMs, {
        p1: {
          seq: i,
          dx: 0,
          dy: 0,
          aimMode: 'auto',
        },
      });
    }
    const evAutoFire = sim
      .consumeEvents()
      .filter((e): e is WeaponFireEvent => e.type === 'fire');
    expect(evAutoFire.length).toBeGreaterThanOrEqual(1);
    // No modo auto, mira no zumbi à direita (dirX ~ 1, dirY ~ 0)
    expect(evAutoFire[0].targetZombieId).toBeGreaterThan(0);
    expect(evAutoFire[0].dirX).toBeCloseTo(1, 2);
  });

  it('normaliza o vetor de mira manual (aimX, aimY) na PlayerInputQueue do servidor', () => {
    const q = new PlayerInputQueue();
    expect(
      q.enqueue(
        {
          seq: 1,
          dx: 0,
          dy: 0,
          aimMode: 'manual',
          aimX: 10,
          aimY: 10,
          firing: true,
        },
        1000
      )
    ).toBe(true);

    const cmd = q.popNextTickCommand()!;
    expect(cmd.aimMode).toBe('manual');
    expect(cmd.firing).toBe(true);
    expect(Math.hypot(cmd.aimX ?? 0, cmd.aimY ?? 0)).toBeCloseTo(1, 5);
  });
});
