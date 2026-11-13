import Phaser from 'phaser';
import { SeededRng } from '@zombie-coop/shared';

export const TEXTURE_KEYS = {
  GROUND_TILE: 'ground_tile',
  PLAYER_BLUE: 'player_blue',
  PLAYER_ORANGE: 'player_orange',
  ZOMBIE_COMMON: 'zombie_common',
  ZOMBIE_FAST: 'zombie_fast',
  ZOMBIE_BRUTE: 'zombie_brute',
  PROJECTILE: 'projectile_bullet',
  MUZZLE_FLASH: 'muzzle_flash',
  PARTICLE_HIT: 'particle_hit',
  PROP_CAR: 'prop_car',
  PROP_CRATE: 'prop_crate',
  PROP_BUSH: 'prop_bush',
  PROP_RUBBLE: 'prop_rubble',
} as const;

/**
 * Gera todas as texturas do jogo por código no BootScene usando `Phaser.GameObjects.Graphics`
 * e `generateTexture()`, sem depender de imagens externas.
 */
export function generateAllTextures(scene: Phaser.Scene): void {
  generateGroundTileTexture(scene);
  generatePlayerTexture(scene, TEXTURE_KEYS.PLAYER_BLUE, 0x2b95ff, 0x0f4c8a);
  generatePlayerTexture(scene, TEXTURE_KEYS.PLAYER_ORANGE, 0xff7b29, 0x8f3905);
  generateCommonZombieTexture(scene);
  generateFastZombieTexture(scene);
  generateBruteZombieTexture(scene);
  generateProjectileAndEffectTextures(scene);
  generateCarPropTexture(scene);
  generateCratePropTexture(scene);
  generateBushPropTexture(scene);
  generateRubblePropTexture(scene);
}

function generateGroundTileTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE_KEYS.GROUND_TILE)) {
    return;
  }

  const size = 256;
  const rng = new SeededRng(42001);
  const g = scene.make.graphics({ x: 0, y: 0 });

  g.fillStyle(0x1b201c, 1);
  g.fillRect(0, 0, size, size);

  for (let i = 0; i < 28; i += 1) {
    const x = rng.nextRange(12, size - 12);
    const y = rng.nextRange(12, size - 12);
    const r = rng.nextRange(10, 32);
    const shade = i % 2 === 0 ? 0x151916 : 0x222823;
    g.fillStyle(shade, 0.55);
    g.fillCircle(x, y, r);
  }

  for (let i = 0; i < 120; i += 1) {
    const x = rng.nextRange(2, size - 2);
    const y = rng.nextRange(2, size - 2);
    const tone = i % 3 === 0 ? 0x2d352e : 0x111412;
    g.fillStyle(tone, 0.7);
    g.fillRect(x, y, 2, 2);
  }

  g.lineStyle(1, 0x121513, 0.45);
  g.beginPath();
  g.moveTo(24, 40);
  g.lineTo(76, 62);
  g.lineTo(118, 54);
  g.moveTo(160, 180);
  g.lineTo(212, 208);
  g.strokePath();

  g.generateTexture(TEXTURE_KEYS.GROUND_TILE, size, size);
  g.destroy();
}

function generatePlayerTexture(
  scene: Phaser.Scene,
  key: string,
  primaryHex: number,
  darkHex: number
): void {
  if (scene.textures.exists(key)) {
    return;
  }

  const size = 44;
  const cx = 22;
  const cy = 22;
  const g = scene.make.graphics({ x: 0, y: 0 });

  g.fillStyle(0x000000, 0.35);
  g.fillCircle(cx, cy + 2, 15);

  g.fillStyle(0x3a4046, 1);
  g.fillRect(cx + 8, cy - 3, 12, 6);
  g.fillStyle(0x7c858e, 1);
  g.fillRect(cx + 12, cy - 2, 8, 3);

  g.fillStyle(darkHex, 1);
  g.fillCircle(cx, cy, 14);
  g.fillStyle(primaryHex, 1);
  g.fillCircle(cx, cy, 11.5);

  g.fillStyle(darkHex, 0.95);
  g.fillRoundedRect(cx - 12, cy - 7, 6, 14, 2);

  g.fillStyle(0xeef6ff, 0.95);
  g.fillRoundedRect(cx + 3, cy - 5, 6, 10, 2);

  g.generateTexture(key, size, size);
  g.destroy();
}

/**
 * Zumbi Comum (raio 14): verde-musgo pútrido, braços estendidos à frente (+X).
 */
function generateCommonZombieTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE_KEYS.ZOMBIE_COMMON)) {
    return;
  }

  const size = 44;
  const cx = 22;
  const cy = 22;
  const g = scene.make.graphics({ x: 0, y: 0 });

  g.fillStyle(0x000000, 0.35);
  g.fillCircle(cx, cy + 2, 15);

  // Braços estendidos à frente (+X)
  g.fillStyle(0x3c5e33, 1);
  g.fillRoundedRect(cx + 4, cy - 11, 13, 5, 2);
  g.fillRoundedRect(cx + 4, cy + 6, 13, 5, 2);

  // Torso circular (raio 14)
  g.fillStyle(0x253b1f, 1);
  g.fillCircle(cx, cy, 14);
  g.fillStyle(0x527d44, 1);
  g.fillCircle(cx, cy, 11.5);

  // Cabeça e olhos amarelados
  g.fillStyle(0x6b995b, 1);
  g.fillCircle(cx + 1, cy, 7);
  g.fillStyle(0xd9ff66, 0.95);
  g.fillCircle(cx + 5, cy - 2.5, 1.6);
  g.fillCircle(cx + 5, cy + 2.5, 1.6);

  g.generateTexture(TEXTURE_KEYS.ZOMBIE_COMMON, size, size);
  g.destroy();
}

/**
 * Zumbi Rápido (raio 11): amarelo-ácido/lima, silhueta esguia e inclinada com garras.
 */
function generateFastZombieTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE_KEYS.ZOMBIE_FAST)) {
    return;
  }

  const size = 40;
  const cx = 20;
  const cy = 20;
  const g = scene.make.graphics({ x: 0, y: 0 });

  g.fillStyle(0x000000, 0.32);
  g.fillCircle(cx, cy + 2, 12);

  // Garras afiadas projetadas para frente (+X)
  g.fillStyle(0xd4eb46, 1);
  g.beginPath();
  g.moveTo(cx + 5, cy - 9);
  g.lineTo(cx + 17, cy - 5);
  g.lineTo(cx + 6, cy - 4);
  g.closePath();
  g.fillPath();

  g.beginPath();
  g.moveTo(cx + 5, cy + 9);
  g.lineTo(cx + 17, cy + 5);
  g.lineTo(cx + 6, cy + 4);
  g.closePath();
  g.fillPath();

  // Corpo ágil (raio 11)
  g.fillStyle(0x4d5c14, 1);
  g.fillCircle(cx, cy, 11);
  g.fillStyle(0x9eb828, 1);
  g.fillCircle(cx, cy, 8.8);

  // Crista dorsal / cabeça pontiaguda
  g.fillStyle(0xe5ff54, 1);
  g.fillTriangle(cx - 7, cy, cx + 6, cy - 5, cx + 6, cy + 5);

  g.fillStyle(0xff3838, 1);
  g.fillCircle(cx + 5, cy - 2, 1.5);
  g.fillCircle(cx + 5, cy + 2, 1.5);

  g.generateTexture(TEXTURE_KEYS.ZOMBIE_FAST, size, size);
  g.destroy();
}

/**
 * Brutamontes (raio 22): carmesim escuro/roxo mutante, ombros largos e placas pesadas.
 */
function generateBruteZombieTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE_KEYS.ZOMBIE_BRUTE)) {
    return;
  }

  const size = 60;
  const cx = 30;
  const cy = 30;
  const g = scene.make.graphics({ x: 0, y: 0 });

  g.fillStyle(0x000000, 0.42);
  g.fillCircle(cx, cy + 3, 23);

  // Punhos pesados à frente (+X)
  g.fillStyle(0x521720, 1);
  g.fillRoundedRect(cx + 8, cy - 19, 16, 9, 3);
  g.fillRoundedRect(cx + 8, cy + 10, 16, 9, 3);

  // Massa corporal (raio 22)
  g.fillStyle(0x3d1017, 1);
  g.fillCircle(cx, cy, 22);
  g.fillStyle(0x822633, 1);
  g.fillCircle(cx, cy, 18.5);

  // Ombros couraçados e cicatrizes
  g.fillStyle(0xa63747, 1);
  g.fillCircle(cx - 2, cy - 9, 8);
  g.fillCircle(cx - 2, cy + 9, 8);
  g.fillCircle(cx + 4, cy, 9);

  // Olhos brilhantes alaranjados
  g.fillStyle(0xff9d3b, 1);
  g.fillCircle(cx + 9, cy - 3.5, 2.2);
  g.fillCircle(cx + 9, cy + 3.5, 2.2);

  g.generateTexture(TEXTURE_KEYS.ZOMBIE_BRUTE, size, size);
  g.destroy();
}

function generateProjectileAndEffectTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(TEXTURE_KEYS.PROJECTILE)) {
    const g = scene.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffe787, 1);
    g.fillRoundedRect(0, 1, 14, 4, 2);
    g.fillStyle(0xffffff, 1);
    g.fillRect(8, 2, 5, 2);
    g.generateTexture(TEXTURE_KEYS.PROJECTILE, 14, 6);
    g.destroy();
  }

  if (!scene.textures.exists(TEXTURE_KEYS.MUZZLE_FLASH)) {
    const g = scene.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffae38, 0.85);
    g.fillCircle(10, 10, 9);
    g.fillStyle(0xfff5cc, 1);
    g.fillCircle(10, 10, 5);
    g.generateTexture(TEXTURE_KEYS.MUZZLE_FLASH, 20, 20);
    g.destroy();
  }

  if (!scene.textures.exists(TEXTURE_KEYS.PARTICLE_HIT)) {
    const g = scene.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture(TEXTURE_KEYS.PARTICLE_HIT, 8, 8);
    g.destroy();
  }
}

function generateCarPropTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE_KEYS.PROP_CAR)) {
    return;
  }

  const w = 88;
  const h = 46;
  const g = scene.make.graphics({ x: 0, y: 0 });

  g.fillStyle(0x090b0a, 0.45);
  g.fillRoundedRect(4, 5, w - 6, h - 6, 8);

  g.fillStyle(0x4b362c, 1);
  g.fillRoundedRect(4, 3, w - 8, h - 8, 7);

  g.fillStyle(0x61473a, 1);
  g.fillRoundedRect(18, 7, 46, h - 16, 4);

  g.fillStyle(0x182022, 0.9);
  g.fillRect(52, 9, 12, h - 20);
  g.fillRect(20, 9, 9, h - 20);

  g.fillStyle(0x33221a, 0.8);
  g.fillCircle(70, 14, 5);
  g.fillCircle(35, 26, 6);

  g.generateTexture(TEXTURE_KEYS.PROP_CAR, w, h);
  g.destroy();
}

function generateCratePropTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE_KEYS.PROP_CRATE)) {
    return;
  }

  const size = 34;
  const g = scene.make.graphics({ x: 0, y: 0 });

  g.fillStyle(0x090b0a, 0.4);
  g.fillRect(4, 4, size - 4, size - 4);

  g.fillStyle(0x4a3b28, 1);
  g.fillRect(2, 2, size - 6, size - 6);

  g.lineStyle(2, 0x2f2417, 1);
  g.strokeRect(3, 3, size - 8, size - 8);

  g.beginPath();
  g.moveTo(4, 4);
  g.lineTo(size - 6, size - 6);
  g.strokePath();

  g.generateTexture(TEXTURE_KEYS.PROP_CRATE, size, size);
  g.destroy();
}

function generateBushPropTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE_KEYS.PROP_BUSH)) {
    return;
  }

  const size = 44;
  const g = scene.make.graphics({ x: 0, y: 0 });

  g.fillStyle(0x0b0e0c, 0.35);
  g.fillCircle(22, 24, 16);

  g.fillStyle(0x2d3825, 0.9);
  g.fillCircle(17, 21, 11);
  g.fillCircle(27, 23, 10);
  g.fillStyle(0x3a472f, 0.85);
  g.fillCircle(22, 17, 10);

  g.lineStyle(1.5, 0x4f4332, 0.85);
  g.beginPath();
  g.moveTo(22, 22);
  g.lineTo(13, 14);
  g.moveTo(22, 22);
  g.lineTo(31, 16);
  g.strokePath();

  g.generateTexture(TEXTURE_KEYS.PROP_BUSH, size, size);
  g.destroy();
}

function generateRubblePropTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE_KEYS.PROP_RUBBLE)) {
    return;
  }

  const size = 36;
  const g = scene.make.graphics({ x: 0, y: 0 });

  g.fillStyle(0x2a2f2c, 0.85);
  g.fillCircle(12, 18, 6);
  g.fillCircle(23, 14, 5);
  g.fillStyle(0x393f3b, 0.8);
  g.fillCircle(19, 24, 4);

  g.generateTexture(TEXTURE_KEYS.PROP_RUBBLE, size, size);
  g.destroy();
}
