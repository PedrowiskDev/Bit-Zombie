import Phaser from 'phaser';
import { BALANCE } from '@zombie-coop/shared';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: BALANCE.VIEWPORT.WIDTH,
  height: BALANCE.VIEWPORT.HEIGHT,
  backgroundColor: '#0c0f0d',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: false,
  },
  scene: [BootScene, GameScene],
};

// Previne menu de contexto e gestos de scroll no container do jogo
window.addEventListener('contextmenu', (e) => e.preventDefault());

export const game = new Phaser.Game(config);
