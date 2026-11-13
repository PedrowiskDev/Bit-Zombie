import Phaser from 'phaser';
import {
  getZombieStats,
  type ProjectileHitEvent,
  type WeaponFireEvent,
} from '@zombie-coop/shared';
import { TEXTURE_KEYS } from '../assets/textureGenerator.js';

interface VisualProjectile {
  id: number;
  sprite: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  traveled: number;
  maxRange: number;
}

interface FloatingLabel {
  text: Phaser.GameObjects.Text;
  vy: number;
  elapsedMs: number;
  durationMs: number;
}

/**
 * Gerencia animações transitórias de combate e polimento visual (Etapas 3 e 6)
 * a partir dos eventos `fire`, `hit` e `level_up`:
 * - Traçante visual dos projéteis
 * - Flash de tiro no cano da pistola (`muzzle_flash`)
 * - Partículas de impacto e eliminação (`particle_hit`)
 * - Números flutuantes de dano (`-12`) e XP (`+1 XP` / `+5 XP`) com limite máximo de instâncias
 * - Onda de choque circular no Level-Up
 */
export class CombatEffectsManager {
  private readonly scene: Phaser.Scene;
  private readonly activeProjectiles = new Map<number, VisualProjectile>();
  private readonly floatingLabels: FloatingLabel[] = [];
  private readonly maxFloatingLabels = 24;
  private hitEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private killEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.hitEmitter = this.scene.add.particles(0, 0, TEXTURE_KEYS.PARTICLE_HIT, {
      emitting: false,
      lifespan: { min: 120, max: 240 },
      speed: { min: 45, max: 135 },
      scale: { start: 0.9, end: 0.1 },
      alpha: { start: 0.95, end: 0 },
      tint: [0xb5e655, 0xffe066, 0x7cb342],
    });
    this.hitEmitter.setDepth(16);

    this.killEmitter = this.scene.add.particles(0, 0, TEXTURE_KEYS.PARTICLE_HIT, {
      emitting: false,
      lifespan: { min: 200, max: 380 },
      speed: { min: 60, max: 180 },
      scale: { start: 1.35, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0x689f38, 0xc62828, 0x9ccc65],
    });
    this.killEmitter.setDepth(16);
  }

  onWeaponFire(ev: WeaponFireEvent): void {
    // 1. Flash curto no cano da arma
    const flash = this.scene.add.image(ev.fromX, ev.fromY, TEXTURE_KEYS.MUZZLE_FLASH);
    flash.setDepth(15);
    flash.setScale(0.95);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 0.25,
      duration: 75,
      onComplete: () => flash.destroy(),
    });

    // 2. Projétil visual animado no cliente
    const existing = this.activeProjectiles.get(ev.projectileId);
    if (existing) {
      existing.sprite.destroy();
    }

    const bullet = this.scene.add.image(ev.fromX, ev.fromY, TEXTURE_KEYS.PROJECTILE);
    bullet.setDepth(14);
    bullet.setRotation(Math.atan2(ev.dirY, ev.dirX));

    this.activeProjectiles.set(ev.projectileId, {
      id: ev.projectileId,
      sprite: bullet,
      vx: ev.dirX * ev.speed,
      vy: ev.dirY * ev.speed,
      traveled: 0,
      maxRange: ev.range,
    });
  }

  onProjectileHit(ev: ProjectileHitEvent): void {
    // Remove projétil visual correspondente imediatamente no impacto
    const visualProj = this.activeProjectiles.get(ev.projectileId);
    if (visualProj) {
      visualProj.sprite.destroy();
      this.activeProjectiles.delete(ev.projectileId);
    }

    // Emite partículas de impacto (e explosão maior ao abater o zumbi)
    this.hitEmitter.explode(6, ev.x, ev.y);
    const dmgDisplay = Number.isInteger(ev.damage)
      ? String(ev.damage)
      : ev.damage.toFixed(1);
    this.spawnFloatingLabel(ev.x, ev.y - 12, `-${dmgDisplay}`, '#ffe082', 380);

    if (ev.killed) {
      this.killEmitter.explode(14, ev.x, ev.y);
      const xpGain = getZombieStats(ev.zombieKind).xp;
      this.spawnFloatingLabel(ev.x, ev.y - 26, `+${xpGain} XP`, '#69f0ae', 520);
    }
  }

  onLevelUpEffect(x: number, y: number): void {
    const ring = this.scene.add.circle(x, y, 18);
    ring.setStrokeStyle(3, 0x63cf88, 0.95);
    ring.setDepth(17);
    this.scene.tweens.add({
      targets: ring,
      radius: 96,
      alpha: 0,
      duration: 420,
      onComplete: () => ring.destroy(),
    });
  }

  private spawnFloatingLabel(
    x: number,
    y: number,
    content: string,
    color: string,
    durationMs: number
  ): void {
    while (this.floatingLabels.length >= this.maxFloatingLabels) {
      const oldest = this.floatingLabels.shift();
      oldest?.text.destroy();
    }

    const txt = this.scene.add.text(x, y, content, {
      fontFamily: 'monospace',
      fontSize: '12px',
      fontStyle: 'bold',
      color,
      stroke: '#0a0e0b',
      strokeThickness: 3,
    });
    txt.setOrigin(0.5, 0.5);
    txt.setDepth(18);

    this.floatingLabels.push({
      text: txt,
      vy: -32,
      elapsedMs: 0,
      durationMs,
    });
  }

  update(deltaMs: number): void {
    const dtSec = Math.min(0.1, Math.max(0, deltaMs / 1000));

    for (const [id, proj] of this.activeProjectiles.entries()) {
      const dx = proj.vx * dtSec;
      const dy = proj.vy * dtSec;
      proj.sprite.x += dx;
      proj.sprite.y += dy;
      proj.traveled += Math.hypot(dx, dy);

      if (proj.traveled >= proj.maxRange) {
        proj.sprite.destroy();
        this.activeProjectiles.delete(id);
      }
    }

    for (let i = this.floatingLabels.length - 1; i >= 0; i -= 1) {
      const item = this.floatingLabels[i];
      item.elapsedMs += deltaMs;
      item.text.y += item.vy * dtSec;
      const progress = Math.min(1, item.elapsedMs / item.durationMs);
      item.text.setAlpha(1 - progress);
      if (item.elapsedMs >= item.durationMs) {
        item.text.destroy();
        this.floatingLabels.splice(i, 1);
      }
    }
  }

  clearAll(): void {
    for (const proj of this.activeProjectiles.values()) {
      proj.sprite.destroy();
    }
    this.activeProjectiles.clear();

    for (const item of this.floatingLabels) {
      item.text.destroy();
    }
    this.floatingLabels.length = 0;
  }
}
