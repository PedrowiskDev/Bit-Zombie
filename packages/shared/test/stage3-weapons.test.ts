import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  Simulation,
  WEAPON_CATALOG,
  computeEffectiveWeaponStats,
  type LootPickedEvent,
  type MeleeSwingEvent,
  type ProjectileHitEvent,
  type WeaponFireEvent,
  type WeaponNoiseEvent,
} from '../src/index.js';

describe('Etapa 3 — Começar com faca e encontrar armas, munição, recarga e loot atômico', () => {
  const tickMs = BALANCE.SIMULATION.TICK_DT_MS; // 50 ms

  it('1. Começa com faca (sem pistola inicial), executa golpe em arco com preparação/impacto/recuperação, empurrão, acerto único por golpe e bloqueio por paredes', () => {
    const sim = new Simulation({ seed: 3001, enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearWallSegments();
    sim.clearLootForTesting();

    const p1 = sim.addPlayer('p1', { x: 2000, y: 2000 });
    expect(p1.activeSlot).toBe('knife');
    expect(p1.activeWeaponId).toBe('knife');
    expect(p1.slot1WeaponId).toBe('');
    expect(p1.slot2WeaponId).toBe('');

    const initialLightAmmo = p1.ammoLight ?? 0;

    // Zumbi a 40 px à direita (dentro do alcance da faca de 56 px e do arco de 95°)
    const zFront = sim.spawnZombie('common', { x: 2040, y: 2000 })!;
    // Segundo zumbi atrás de uma parede sólida dentro do alcance (x = 2042, y = 2025, com parede em y = 2012)
    sim.addWallSegment({
      x1: 1990,
      y1: 2012,
      x2: 2060,
      y2: 2012,
      blocksVision: true,
      blocksProjectiles: true,
    });
    const zBehindWall = sim.spawnZombie('common', { x: 2035, y: 2028 })!;
    sim.consumeEvents();

    // Tick 1: inicia golpe manual na direção Leste (aimX: 1, aimY: 0, firing: true)
    sim.step(tickMs, {
      p1: {
        seq: 1,
        dx: 0,
        dy: 0,
        aimMode: 'manual',
        aimX: 1,
        aimY: 0,
        firing: true,
      },
    });

    const snapWindup = sim.getSnapshot();
    const p1Windup = snapWindup.players[0];
    // No início do golpe (50 ms < 70 ms windup), está na fase de preparação ('windup')
    expect(p1Windup.meleePhase).toBe('windup');

    const swingEvents = sim
      .consumeEvents()
      .filter((e): e is MeleeSwingEvent => e.type === 'melee_swing');
    expect(swingEvents).toHaveLength(1);
    expect(swingEvents[0].weaponId).toBe('knife');

    // Tick 2 (+50 ms = 100 ms acumulados): entra na fase de impacto ('active') e acerta zFront com empurrão
    sim.step(tickMs, {
      p1: { seq: 2, dx: 0, dy: 0, aimMode: 'manual', aimX: 1, aimY: 0, firing: false },
    });
    const snapActive = sim.getSnapshot();
    expect(snapActive.players[0].meleePhase).toBe('active');

    const hitsTick2 = sim
      .consumeEvents()
      .filter((e): e is ProjectileHitEvent => e.type === 'hit');
    expect(hitsTick2).toHaveLength(1);
    expect(hitsTick2[0].zombieId).toBe(zFront.id);
    expect(hitsTick2[0].weaponId).toBe('knife');

    const zFrontAfterHit = snapActive.zombies.find((z) => z.id === zFront.id)!;
    expect(zFrontAfterHit.hp).toBe(zFront.hp - BALANCE.WEAPONS.KNIFE.DAMAGE);
    // Verifica que houve empurrão (knockback) afastando o zumbi para a direita
    expect(zFrontAfterHit.x).toBeGreaterThan(2045);

    // Verifica que o zumbi atrás da parede NÃO sofreu dano
    const zWallAfter = snapActive.zombies.find((z) => z.id === zBehindWall.id)!;
    expect(zWallAfter.hp).toBe(zBehindWall.hp);

    // Tick 3 (+50 ms): ainda em 'active', mas NÃO deve acertar zFront uma segunda vez no mesmo golpe!
    sim.step(tickMs, {});
    const hitsTick3 = sim
      .consumeEvents()
      .filter((e): e is ProjectileHitEvent => e.type === 'hit');
    expect(hitsTick3).toHaveLength(0);

    // Tick 4 (+50 ms): entra em 'recovery' (recuperação)
    sim.step(tickMs, {});
    expect(sim.getSnapshot().players[0].meleePhase).toBe('recovery');

    // Avança até terminar a recuperação e verifica que nenhuma munição foi consumida
    for (let i = 0; i < 4; i += 1) {
      sim.step(tickMs, {});
    }
    const snapIdle = sim.getSnapshot().players[0];
    expect(snapIdle.meleePhase).toBe('idle');
    expect(snapIdle.ammoLight).toBe(initialLightAmmo);
  });

  it('2. Encontra e equipa armas (Bastão, Pistola, Escopeta, Submetralhadora, Rifle), consome carregador, recarrega da reserva, troca de arma e mantém faca acessível', () => {
    expect(Object.keys(WEAPON_CATALOG)).toEqual([
      'knife',
      'bat',
      'pistol',
      'shotgun',
      'smg',
      'rifle',
    ]);

    const sim = new Simulation({ seed: 3002, enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();
    sim.addPlayer('p1', { x: 2000, y: 2000 });

    // Coloca uma Pistola (com 2 balas no carregador) e uma Escopeta no chão perto do jogador
    sim.spawnLootItem({
      kind: 'weapon',
      x: 2015,
      y: 2000,
      weaponId: 'pistol',
      magAmmo: 2,
      label: 'Pistola 9mm',
    });
    sim.spawnLootItem({
      kind: 'weapon',
      x: 2030,
      y: 2000,
      weaponId: 'shotgun',
      magAmmo: 6,
      label: 'Escopeta Cal. 12',
    });

    // Jogador interage para pegar a Pistola -> vai para slot1 e ativa slot1
    expect(sim.interactPlayerLoot('p1')).toBe(true);
    let p1 = sim.getSnapshot().players[0];
    expect(p1.slot1WeaponId).toBe('pistol');
    expect(p1.slot1MagAmmo).toBe(2);
    expect(p1.activeSlot).toBe('slot1');
    expect(p1.activeWeaponId).toBe('pistol');

    // Interage novamente para pegar a Escopeta -> vai para slot2 e ativa slot2
    expect(sim.interactPlayerLoot('p1')).toBe(true);
    p1 = sim.getSnapshot().players[0];
    expect(p1.slot2WeaponId).toBe('shotgun');
    expect(p1.slot2MagAmmo).toBe(6);
    expect(p1.activeSlot).toBe('slot2');

    // Dispara a Escopeta manualmente: gera 5 balins em leque, consome 1 cartucho (6 -> 5) e emite evento de ruído
    sim.consumeEvents();
    sim.step(tickMs, {
      p1: {
        seq: 1,
        dx: 0,
        dy: 0,
        aimMode: 'manual',
        aimX: 1,
        aimY: 0,
        firing: true,
      },
    });

    const shotgunEvents = sim.consumeEvents();
    const shotgunFires = shotgunEvents.filter(
      (e): e is WeaponFireEvent => e.type === 'fire'
    );
    const shotgunNoise = shotgunEvents.filter(
      (e): e is WeaponNoiseEvent => e.type === 'weapon_noise'
    );
    expect(shotgunFires).toHaveLength(BALANCE.WEAPONS.SHOTGUN.PELLETS);
    expect(shotgunNoise).toHaveLength(1);
    expect(shotgunNoise[0].radiusPx).toBe(BALANCE.WEAPONS.SHOTGUN.NOISE_RADIUS_PX);
    expect(sim.getSnapshot().players[0].slot2MagAmmo).toBe(5);

    // Troca para o slot1 (Pistola com 2 balas) via comando switchSlot
    sim.step(tickMs, {
      p1: {
        seq: 2,
        dx: 0,
        dy: 0,
        aimMode: 'manual',
        aimX: 1,
        aimY: 0,
        firing: false,
        switchSlot: 'slot1',
      },
    });
    expect(sim.getSnapshot().players[0].activeSlot).toBe('slot1');
    expect(sim.getSnapshot().players[0].activeWeaponId).toBe('pistol');

    // Aguarda cooldown e dispara as 2 balas da Pistola para esvaziar o carregador
    for (let seq = 3; seq <= 20; seq += 1) {
      sim.step(tickMs, {
        p1: {
          seq,
          dx: 0,
          dy: 0,
          aimMode: 'manual',
          aimX: 1,
          aimY: 0,
          firing: true,
        },
      });
      if ((sim.getSnapshot().players[0].reloadRemainingMs ?? 0) > 0) {
        break;
      }
    }

    // Carregador zerou (0) e a recarga com duração (1100 ms) começou automaticamente!
    p1 = sim.getSnapshot().players[0];
    expect(p1.slot1MagAmmo).toBe(0);
    expect(p1.reloadRemainingMs).toBeGreaterThan(0);
    const reserveBeforeReload = p1.ammoLight ?? 0;

    // Avança 25 ticks (1250 ms > 1100 ms) com o gatilho solto para concluir a recarga
    for (let i = 0; i < 25; i += 1) {
      sim.step(tickMs, {
        p1: {
          seq: 50 + i,
          dx: 0,
          dy: 0,
          aimMode: 'manual',
          aimX: 1,
          aimY: 0,
          firing: false,
        },
      });
    }

    p1 = sim.getSnapshot().players[0];
    expect(p1.reloadRemainingMs).toBe(0);
    expect(p1.slot1MagAmmo).toBe(BALANCE.WEAPONS.PISTOL.MAG_SIZE); // 12
    expect(p1.ammoLight).toBe(reserveBeforeReload - BALANCE.WEAPONS.PISTOL.MAG_SIZE);

    // A faca continua sempre acessível no slot 'knife'
    expect(sim.switchPlayerSlot('p1', 'knife')).toBe(true);
    expect(sim.getSnapshot().players[0].activeWeaponId).toBe('knife');
  });

  it('3. Validação autoritativa de loot: dois jogadores tentando pegar o mesmo item ou abrir o mesmo recipiente no mesmo tick NUNCA duplicam o loot', () => {
    const sim = new Simulation({ seed: 3003, enableAutoSpawn: false });
    sim.clearPropsForTesting();
    sim.clearLootForTesting();

    sim.addPlayer('p1', { x: 2000, y: 2000 });
    sim.addPlayer('p2', { x: 2000, y: 2000 });

    // 1 único Rifle no chão exatamente entre p1 e p2 (fora do raio de auto-walk de 28 px, mas dentro de PICKUP_RADIUS_PX = 54 px)
    const rifleLoot = sim.spawnLootItem({
      kind: 'weapon',
      x: 2042,
      y: 2000,
      weaponId: 'rifle',
      magAmmo: 8,
      label: 'Rifle de Precisão',
    });
    sim.consumeEvents();

    // Ambos enviam interact: true no mesmo tick
    sim.step(tickMs, {
      p1: { seq: 1, dx: 0, dy: 0, interact: true },
      p2: { seq: 1, dx: 0, dy: 0, interact: true },
    });

    const snap = sim.getSnapshot();
    const p1 = snap.players.find((p) => p.id === 'p1')!;
    const p2 = snap.players.find((p) => p.id === 'p2')!;

    // Apenas UM jogador deve ter recebido o Rifle, e o item deve ter sumido do chão
    const rifleOwners = [p1, p2].filter((p) => p.slot1WeaponId === 'rifle');
    expect(rifleOwners).toHaveLength(1);
    expect(snap.lootItems?.find((i) => i.id === rifleLoot.id)).toBeUndefined();

    const pickedEvents = sim
      .consumeEvents()
      .filter((e): e is LootPickedEvent => e.type === 'loot_picked');
    expect(pickedEvents).toHaveLength(1);

    // Testa também um recipiente pesquisável disputado pelos dois jogadores no mesmo tick
    sim.spawnLootContainer({
      kind: 'ammo_box',
      x: 2045,
      y: 2000,
      label: 'Caixa de Munição Militar',
      contents: [
        {
          kind: 'ammo',
          ammoType: 'heavy',
          ammoAmount: 20,
          label: 'Munição Pesada (+20)',
        },
      ],
    });

    const totalHeavyBefore =
      (sim.getSnapshot().players[0].ammoHeavy ?? 0) +
      (sim.getSnapshot().players[1].ammoHeavy ?? 0);

    sim.step(tickMs, {
      p1: { seq: 2, dx: 0, dy: 0, interact: true },
      p2: { seq: 2, dx: 0, dy: 0, interact: true },
    });

    const snapAfterContainer = sim.getSnapshot();
    const totalHeavyAfter =
      (snapAfterContainer.players[0].ammoHeavy ?? 0) +
      (snapAfterContainer.players[1].ammoHeavy ?? 0);

    // O total de munição pesada somado da dupla deve ter aumentado em exatos +20 (nunca +40)
    expect(totalHeavyAfter - totalHeavyBefore).toBe(20);
    expect(snapAfterContainer.lootContainers?.[0].opened).toBe(true);
  });

  it('4. Cartas de evolução beneficiam quem está apenas com Faca/Bastão (arco, alcance, empurrão e dano) e também Armas de Fogo', () => {
    const baseKnife = computeEffectiveWeaponStats(1, [], 'knife');
    const upgradedKnife = computeEffectiveWeaponStats(
      2,
      [
        { upgradeId: 'pistol_range_boost', stacks: 1 },
        { upgradeId: 'pistol_multishot_boost', stacks: 1 },
        { upgradeId: 'pistol_pierce_boost', stacks: 1 },
      ],
      'knife'
    );

    expect(upgradedKnife.damage).toBeGreaterThan(baseKnife.damage);
    expect(upgradedKnife.rangePx).toBeGreaterThan(baseKnife.rangePx);
    expect(upgradedKnife.arcDeg).toBe(baseKnife.arcDeg + 10 + 25);
    expect(upgradedKnife.knockbackPx).toBeGreaterThan(baseKnife.knockbackPx);

    const baseShotgun = computeEffectiveWeaponStats(1, [], 'shotgun');
    const upgradedShotgun = computeEffectiveWeaponStats(
      2,
      [
        { upgradeId: 'pistol_multishot_boost', stacks: 1 },
        { upgradeId: 'pistol_pierce_boost', stacks: 1 },
      ],
      'shotgun'
    );
    expect(upgradedShotgun.projectileCount).toBe(baseShotgun.projectileCount + 1);
    expect(upgradedShotgun.pierceCount).toBe(baseShotgun.pierceCount + 1);
  });

  it('5. Escassez de itens e colisão física sólida contra objetos do cenário (props e caixas pesquisáveis)', () => {
    const sim = new Simulation({ seed: 2026, enableAutoSpawn: false });
    const initialSnap = sim.getSnapshot();

    // Verifica que os itens estão mais escassos (2 iniciais + 10 no mundo = 12 itens; 8 recipientes no total)
    expect(initialSnap.lootItems?.length).toBe(12);
    expect(initialSnap.lootContainers?.length).toBe(8);

    // Escolhe um prop circular (crate, bush ou rubble) e verifica bloqueio frontal + ausência de penetração em qualquer tick
    const targetProp =
      initialSnap.props.find((p) => p.kind !== 'car') ?? initialSnap.props[0];
    expect(targetProp).toBeDefined();

    sim.addPlayer('p1', { x: targetProp.x - 60, y: targetProp.y });

    for (let seq = 1; seq <= 25; seq += 1) {
      sim.step(tickMs, {
        p1: { seq, dx: 1, dy: 0 },
      });
      const pNow = sim.getSnapshot().players[0];
      const dNow = Math.hypot(pNow.x - targetProp.x, pNow.y - targetProp.y);
      // Em nenhum tick o jogador pode atravessar o interior do objeto do cenário
      expect(dNow).toBeGreaterThanOrEqual(BALANCE.PLAYER.RADIUS + 11);
    }

    const pAfterProp = sim.getSnapshot().players[0];
    expect(pAfterProp.x).toBeLessThan(targetProp.x);
  });
});
