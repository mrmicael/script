// Paints every texture at boot and hands it to Phaser. Landmark art is big and
// only needed deeper down, so it is painted after the first frame.

import Phaser from 'phaser';
import type { UpgradeId } from '../core/balance';
import { ARTIFACTS } from '../core/content';
import { ORE_COUNT, ORES } from '../core/materials';
import { paintChest, paintArtifact, paintFlask } from './art/items';
import { paintLandmarks } from './art/landmarks';
import { paintOreIcon, paintOres } from './art/ores';
import { paintDrill, paintFlame, paintGlow, paintPodBody } from './art/pod';
import { paintBush, paintCloud, paintHills, paintLiftTower, paintPine, paintSignpost, paintSky, paintWorkshop } from './art/surface';
import { paintBackdrop, paintTerrain } from './art/terrain';
import { Pix, shade } from './paint';

const add = (scene: Phaser.Scene, key: string, pix: Pix, linear = false): void => {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, pix.toCanvas());
  if (linear && tex) tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
};

/** ore icons as data URLs, for the DOM interface */
export const oreIconUrls: string[] = [];
export const artifactIconUrls: string[] = [];

export function paintCoreTextures(scene: Phaser.Scene): void {
  add(scene, 'terrain', paintTerrain().pix);
  add(scene, 'backdrop', paintBackdrop().pix);
  add(scene, 'ores', paintOres().pix);
  add(scene, 'sky', paintSky(), true);
  add(scene, 'hills-far', paintHills(512, 120, 0x8fb8d8, 0xa8cce6, 1.3, 0.5));
  add(scene, 'hills-near', paintHills(512, 110, 0x5f9a5a, 0x7fbf6a, 4.1, 1));
  for (let i = 0; i < 3; i++) add(scene, `cloud${i}`, paintCloud(64 + i * 16, 26 + i * 4, i * 7));
  add(scene, 'workshop', paintWorkshop());
  add(scene, 'lift', paintLiftTower());
  add(scene, 'sign', paintSignpost());
  for (let i = 0; i < 3; i++) add(scene, `pine${i}`, paintPine(56 + i * 14, i * 3));
  add(scene, 'bush', paintBush(5));
  add(scene, 'chest', paintChest());
  add(scene, 'flask', paintFlask());
  for (let i = 0; i < ARTIFACTS.length; i++) add(scene, `artifact${i}`, paintArtifact(i));
  for (let e = 0; e < 7; e++) for (let f = 0; f < 3; f++) add(scene, `flame${e}-${f}`, paintFlame(e, f));

  // effect sprites
  const px = new Pix(4, 4);
  px.rect(0, 0, 4, 4, 0xffffff);
  add(scene, 'px', px);
  const chunk = new Pix(6, 6);
  chunk.rect(1, 0, 4, 6, 0xffffff);
  chunk.rect(0, 1, 6, 4, 0xffffff);
  chunk.rect(1, 1, 3, 2, 0xffffff);
  add(scene, 'chunk', chunk);
  const spark = new Pix(3, 3);
  spark.set(1, 0, 0xffffff);
  spark.set(0, 1, 0xffffff);
  spark.set(1, 1, 0xffffff);
  spark.set(2, 1, 0xffffff);
  spark.set(1, 2, 0xffffff);
  add(scene, 'spark', spark);
  add(scene, 'glow', paintGlow(64, 0xffffff, 2), true);
  add(scene, 'glowSoft', paintGlow(64, 0xffffff, 1.2), true);
  add(scene, 'puff', paintGlow(16, 0xffffff, 1));
  // the darkness: opaque everywhere except a soft hole in the middle
  const S = 512;
  const dark = new Pix(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
      const hole = 0.045;
      const edge = 0.1;
      const a = d < hole ? 0 : d > edge ? 1 : Math.pow((d - hole) / (edge - hole), 1.6);
      dark.set(x, y, 0x000000, Math.round(a * 255));
    }
  add(scene, 'darkness', dark, true);
  // cracks over a tile being drilled
  for (let f = 0; f < 4; f++) {
    const c = new Pix(32, 32);
    const lines: [number, number, number, number][] = [
      [16, 16, 4, 6],
      [16, 16, 27, 9],
      [16, 16, 9, 28],
      [16, 16, 26, 26],
      [10, 11, 3, 16],
      [22, 12, 29, 18],
    ];
    for (let i = 0; i < Math.min(lines.length, 2 + f * 2); i++) {
      const [a, b, x, y] = lines[i];
      c.line(a, b, x, y, 0x140c10, 200);
    }
    add(scene, `crack${f}`, c);
  }
  // scanner ping
  const ping = new Pix(12, 12);
  ping.circle(6, 6, 5.5, 0xffffff, 255);
  ping.circle(6, 6, 3.5, 0xffffff, 0);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (Math.hypot(x + 0.5 - 6, y + 0.5 - 6) < 3.6) ping.clearPx(x, y);
  ping.circle(6, 6, 1.6, 0xffffff);
  add(scene, 'ping', ping);

  // ore icons for the interface
  oreIconUrls.length = 0;
  for (let o = 0; o < ORE_COUNT; o++) oreIconUrls.push(o ? paintOreIcon(o).toCanvas().toDataURL() : '');
  artifactIconUrls.length = 0;
  for (let i = 0; i < ARTIFACTS.length; i++) artifactIconUrls.push(paintArtifact(i).toCanvas().toDataURL());
  void ORES;
  void shade;
}

/** the machine: regenerated whenever the upgrade levels change */
export function paintPodTextures(scene: Phaser.Scene, lv: Record<UpgradeId, number>): void {
  add(scene, 'pod0', paintPodBody(lv, 0));
  add(scene, 'pod1', paintPodBody(lv, 1));
  for (let f = 0; f < 4; f++) add(scene, `drill${f}`, paintDrill(lv.drill, f));
}

/** landmark art: one front and one back texture per landmark type (or null) */
export function paintLandmarkTextures(scene: Phaser.Scene): { front: boolean; back: boolean }[] {
  return paintLandmarks().map((art, i) => {
    if (art.front) add(scene, `lmf${i}`, art.front);
    if (art.back) add(scene, `lmb${i}`, art.back);
    return { front: !!art.front, back: !!art.back };
  });
}
