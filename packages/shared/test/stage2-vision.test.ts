import { describe, it, expect } from 'vitest';
import {
  Simulation,
  BALANCE,
  isPointInVisionCone,
  hasLineOfSight,
  computeVisionPolygon,
  doesPropBlockVision,
  buildObstaclesFromProps,
  type VisionObstacles,
  type PropData,
  type SegmentObstacle,
} from '../src/index.js';

describe('Etapa 2 — Campo de visão orientado pela mira (Vision Cone, LOS & Combat)', () => {
  it('1. 110-degree vision cone detects targets inside cone and hides targets outside cone', () => {
    const playerX = 2000;
    const playerY = 2000;
    const facingEast = 0; // 0 radians = East (+X)
    const emptyObstacles: VisionObstacles = { circles: [], segments: [] };

    // Directly in front (angle diff 0 deg <= 55 deg)
    expect(
      isPointInVisionCone(playerX, playerY, facingEast, 2250, 2000, emptyObstacles)
    ).toBe(true);

    // At 45 degrees inside the 110-degree cone (half-angle = 55 deg)
    const angle45 = (45 * Math.PI) / 180;
    expect(
      isPointInVisionCone(
        playerX,
        playerY,
        facingEast,
        playerX + Math.cos(angle45) * 300,
        playerY + Math.sin(angle45) * 300,
        emptyObstacles
      )
    ).toBe(true);

    // At 75 degrees outside the 110-degree cone (75 deg > 55 deg half-angle)
    const angle75 = (75 * Math.PI) / 180;
    expect(
      isPointInVisionCone(
        playerX,
        playerY,
        facingEast,
        playerX + Math.cos(angle75) * 300,
        playerY + Math.sin(angle75) * 300,
        emptyObstacles
      )
    ).toBe(false);

    // Directly behind the player (180 deg) outside close sense radius
    expect(
      isPointInVisionCone(playerX, playerY, facingEast, 1800, 2000, emptyObstacles)
    ).toBe(false);

    // Beyond max vision range (RANGE_PX = 480)
    expect(
      isPointInVisionCone(
        playerX,
        playerY,
        facingEast,
        playerX + BALANCE.VISION.RANGE_PX + 80,
        playerY,
        emptyObstacles
      )
    ).toBe(false);
  });

  it('2. Solid obstacles (walls, cars, crates) block line of sight while bushes and rubble do not', () => {
    expect(doesPropBlockVision('car')).toBe(true);
    expect(doesPropBlockVision('crate')).toBe(true);
    expect(doesPropBlockVision('bush')).toBe(false);
    expect(doesPropBlockVision('rubble')).toBe(false);

    const props: PropData[] = [
      { id: 1, kind: 'car', x: 2150, y: 2000, scale: 1.0, rotation: 0 },
      { id: 2, kind: 'bush', x: 2000, y: 2150, scale: 1.0, rotation: 0 },
    ];
    const wallSegments: SegmentObstacle[] = [
      {
        x1: 1850,
        y1: 1900,
        x2: 1850,
        y2: 2100,
        blocksVision: true,
        blocksProjectiles: true,
      },
    ];
    const obstacles = buildObstaclesFromProps(props, wallSegments);

    // Zombie at (2300, 2000) is inside East vision cone, but blocked by 'car' at (2150, 2000)
    expect(hasLineOfSight(2000, 2000, 2300, 2000, obstacles)).toBe(false);
    expect(isPointInVisionCone(2000, 2000, 0, 2300, 2000, obstacles)).toBe(false);

    // Zombie at (2000, 2300) is inside South vision cone, and 'bush' at (2000, 2150) does NOT block vision
    expect(hasLineOfSight(2000, 2000, 2000, 2300, obstacles)).toBe(true);
    expect(isPointInVisionCone(2000, 2000, Math.PI / 2, 2000, 2300, obstacles)).toBe(true);

    // Zombie at (1700, 2000) is inside West vision cone, but blocked by wall segment at x=1850
    expect(hasLineOfSight(2000, 2000, 1700, 2000, obstacles)).toBe(false);
    expect(isPointInVisionCone(2000, 2000, Math.PI, 1700, 2000, obstacles)).toBe(false);

    // Vision polygon clips rays against the wall segment
    const poly = computeVisionPolygon(2000, 2000, Math.PI, obstacles, {
      rangePx: 480,
      coneAngleDeg: 110,
      rayCount: 25,
    });
    expect(poly.length).toBe(26); // origin + 25 ray endpoints
    // The central ray pointing West (angle = PI) must stop at x = 1850 instead of reaching 2000 - 480 = 1520
    const midPoint = poly[13];
    expect(midPoint.x).toBeGreaterThanOrEqual(1849);
    expect(midPoint.x).toBeLessThanOrEqual(1851);
  });

  it('3. Auto-fire only selects visible enemies inside the 110-deg cone with valid LOS and never rotates vision to hidden enemies', () => {
    const sim = new Simulation({
      seed: 10101,
      gameMode: 'rounds',
      enableAutoSpawn: false,
      startingWeapon: 'pistol',
    });
    sim.clearPropsForTesting();
    sim.clearWallSegments();

    sim.addPlayer('p1', { x: 2000, y: 2000 });
    // Spawn a zombie directly BEHIND the player (West at 1820, 2000)
    sim.spawnZombie('common', { x: 1820, y: 2000 });
    sim.consumeEvents();

    // Step with aimMode: 'auto' looking East (aimX: 1, aimY: 0)
    sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
      p1: {
        seq: 1,
        dx: 0,
        dy: 0,
        aimMode: 'auto',
        aimX: 1,
        aimY: 0,
        firing: false,
      },
    });

    // Player MUST still be facing East (0 rad) and must NOT have fired at the hidden zombie behind them
    const snap1 = sim.getSnapshot();
    expect(Math.abs(snap1.players[0].facingAngle)).toBeLessThan(0.01);
    expect(sim.getActiveProjectileCount()).toBe(0);

    // Now add a wall segment in front of the player at x = 2100 and spawn a zombie behind the wall at x = 2220
    sim.addWallSegment({
      x1: 2100,
      y1: 1900,
      x2: 2100,
      y2: 2100,
      blocksVision: true,
      blocksProjectiles: true,
    });
    sim.spawnZombie('common', { x: 2220, y: 2000 });

    sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
      p1: {
        seq: 2,
        dx: 0,
        dy: 0,
        aimMode: 'auto',
        aimX: 1,
        aimY: 0,
        firing: false,
      },
    });

    // Wall blocks LOS to (2220, 2000), so auto-fire STILL must not shoot through the wall
    expect(sim.getActiveProjectileCount()).toBe(0);

    // Now rotate aim West (aimX: -1, aimY: 0) where the first zombie is in unobstructed view
    sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
      p1: {
        seq: 3,
        dx: 0,
        dy: 0,
        aimMode: 'auto',
        aimX: -1,
        aimY: 0,
        firing: false,
      },
    });

    const snap3 = sim.getSnapshot();
    expect(Math.abs(Math.abs(snap3.players[0].facingAngle) - Math.PI)).toBeLessThan(0.05);
    expect(sim.getActiveProjectileCount()).toBeGreaterThan(0);
  });

  it('4. Manual mode allows looking around without firing, fires on command, and walls block projectiles', () => {
    const sim = new Simulation({
      seed: 20202,
      gameMode: 'rounds',
      enableAutoSpawn: false,
      startingWeapon: 'pistol',
    });
    sim.clearPropsForTesting();
    sim.clearWallSegments();

    sim.addPlayer('p1', { x: 2000, y: 2000 });

    // Look South (aimX: 0, aimY: 1) with firing: false -> rotates facingAngle without spawning projectiles
    sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
      p1: {
        seq: 1,
        dx: 0,
        dy: 0,
        aimMode: 'manual',
        aimX: 0,
        aimY: 1,
        firing: false,
      },
    });

    expect(sim.getSnapshot().players[0].facingAngle).toBeCloseTo(Math.PI / 2, 2);
    expect(sim.getActiveProjectileCount()).toBe(0);

    // Place a wall at y = 2120 and a zombie behind it at y = 2220, and fire manually South
    sim.addWallSegment({
      x1: 1900,
      y1: 2120,
      x2: 2100,
      y2: 2120,
      blocksVision: true,
      blocksProjectiles: true,
    });
    const blockedZombie = sim.spawnZombie('common', { x: 2000, y: 2220 })!;
    const initialHp = blockedZombie.hp;

    sim.step(BALANCE.SIMULATION.TICK_DT_MS, {
      p1: {
        seq: 2,
        dx: 0,
        dy: 0,
        aimMode: 'manual',
        aimX: 0,
        aimY: 1,
        firing: true,
      },
    });
    expect(sim.getActiveProjectileCount()).toBeGreaterThan(0);

    // Step simulation forward so projectile travels towards y = 2220; wall at y = 2120 must destroy projectile before hitting zombie
    for (let i = 0; i < 10; i += 1) {
      sim.step(BALANCE.SIMULATION.TICK_DT_MS, {});
    }

    expect(sim.getActiveProjectileCount()).toBe(0);
    const zombieAfter = sim.getSnapshot().zombies.find((z) => z.id === blockedZombie.id)!;
    expect(zombieAfter.hp).toBe(initialHp);
  });
});
