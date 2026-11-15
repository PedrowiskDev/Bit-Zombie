import type Phaser from 'phaser';
import type { LootContainerSnapshot, WorldLootItemSnapshot } from '@zombie-coop/shared';

export function drawLootItem(g: Phaser.GameObjects.Graphics, item: WorldLootItemSnapshot): void {
  const { x, y } = item;
  const rect = (dx: number, dy: number, w: number, h: number, color: number) => {
    g.fillStyle(color);
    g.fillRect(x + dx, y + dy, w, h);
  };
  if (item.kind === 'weapon') {
    const steel = 0xa6b4bd;
    const dark = 0x303640;
    const wood = 0xa46b40;
    switch (item.weaponId) {
      case 'knife':
        rect(-15, -3, 10, 6, dark);
        rect(-7, -5, 3, 10, steel);
        g.fillStyle(steel);
        g.fillTriangle(x - 4, y - 4, x + 16, y - 3, x - 4, y + 4);
        break;
      case 'bat':
        g.fillStyle(wood);
        g.fillRoundedRect(x - 20, y - 3, 40, 6, 3);
        g.fillRoundedRect(x + 1, y - 5, 19, 10, 4);
        rect(-16, -3, 9, 6, dark);
        break;
      case 'shotgun':
        rect(-24, -2, 13, 9, wood);
        rect(-12, -4, 33, 5, steel);
        rect(1, 1, 11, 5, wood);
        rect(-11, 1, 5, 5, dark);
        break;
      case 'rifle':
        rect(-24, -2, 12, 7, wood);
        rect(-12, -4, 37, 5, steel);
        rect(-9, -8, 13, 3, dark);
        rect(-5, 1, 6, 8, dark);
        rect(4, 1, 10, 4, wood);
        break;
      case 'smg':
        rect(-19, -3, 10, 4, dark);
        rect(-10, -6, 22, 9, steel);
        rect(12, -4, 7, 4, dark);
        rect(-3, 3, 6, 10, dark);
        rect(-10, 3, 5, 6, dark);
        break;
      default:
        rect(-11, -6, 25, 6, steel);
        rect(-11, 0, 9, 10, dark);
        rect(-2, 0, 10, 2, dark);
        break;
    }
  } else if (item.kind === 'ammo') {
    const shells = item.ammoType === 'shells';
    const heavy = item.ammoType === 'heavy';
    const h = heavy ? 21 : 15;
    for (const dx of [-10, -3, 4]) {
      rect(dx, -h / 2, 5, h, shells ? 0xc04b36 : 0xb98c4d);
      rect(dx, h / 2 - 3, 5, 3, 0xf0ce86);
      if (!shells) {
        g.fillStyle(0xe3a775);
        g.fillTriangle(x + dx, y - h / 2, x + dx + 5, y - h / 2, x + dx + 2.5, y - h / 2 - 4);
      }
    }
  } else if (item.kind === 'medkit') {
    g.fillStyle(0xe2dbd1);
    g.fillRoundedRect(x - 11, y - 8, 22, 16, 3);
    rect(-2, -5, 4, 10, 0xb63532);
    rect(-5, -2, 10, 4, 0xb63532);
  } else {
    rect(-10, -6, 20, 12, 0xbeb088);
    rect(-7, 2, 14, 2, 0x766e52);
  }
}

export function drawLootContainer(g: Phaser.GameObjects.Graphics, crate: LootContainerSnapshot, alpha: number): void {
  const { x, y, kind, opened } = crate;
  const metal = kind !== 'supply_crate';
  const top = kind === 'weapon_case' ? 0x647e96 : kind === 'ammo_box' ? 0x63724a : 0xa98253;
  const width = kind === 'weapon_case' ? 40 : 32;
  g.fillStyle(0x171c1b, alpha);
  g.fillRoundedRect(x - width / 2 - 2, y - 12, width + 4, 26, 3);
  g.fillStyle(opened ? 0x292d2a : top, alpha);
  g.fillRoundedRect(x - width / 2, y - 10, width, 20, 2);
  g.fillStyle(top, alpha);
  g.fillRect(x - width / 2, y - 10, width, opened ? 5 : 2);
  if (!metal) {
    g.fillStyle(0x6b5035, alpha);
    g.fillRect(x - 11, y - 9, 4, 18);
    g.fillRect(x + 7, y - 9, 4, 18);
  }
  if (!opened) {
    g.fillStyle(metal ? 0xbfc7c0 : 0xe5b579, alpha);
    g.fillRect(x - 8, y + 7, 4, 5);
    g.fillRect(x + 4, y + 7, 4, 5);
    if (metal) g.fillRect(x - 5, y - 2, 10, 3);
  }
}
