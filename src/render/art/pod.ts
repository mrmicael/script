// The drilling machine. Painted from its upgrade levels, so every purchase
// shows: a longer, brighter drill bit, more radiator fins, armour plates, a
// bigger cargo crate, a second exhaust, a scanner dish.

import type { UpgradeId } from '../../core/balance';
import { Pix, mix, shade, type RGB } from '../paint';

export const POD_W = 44;
export const POD_H = 32;
/** pixel in the body canvas that sits on the pod's centre */
export const POD_CX = 22;
export const POD_CY = 19;

const INK = 0x1a1420;

export function paintPodBody(lv: Record<UpgradeId, number>, treadFrame = 0): Pix {
  const p = new Pix(POD_W, POD_H);
  const hullCol: RGB = lv.hull >= 5 ? 0xffb02e : 0xffc531;
  const hullDark = shade(hullCol, -0.3);
  const hullLight = shade(hullCol, 0.35);

  // cargo crate on the back, growing with capacity
  const cw = 5 + lv.cargo;
  const cx0 = 11 - cw;
  const crateTop = lv.cargo >= 4 ? 8 : 10;
  const crateCol: RGB = lv.cargo >= 4 ? 0x6f8fa8 : 0xa8713f;
  p.rect(cx0, crateTop, cw + 2, 22 - crateTop, shade(crateCol, -0.35));
  p.rect(cx0 + 1, crateTop + 1, cw, 20 - crateTop, crateCol);
  p.rect(cx0 + 1, crateTop + 1, cw, 1, shade(crateCol, 0.35));
  for (let x = cx0 + 3; x < cx0 + cw; x += 4) p.rect(x, crateTop + 1, 1, 20 - crateTop, shade(crateCol, -0.2));
  p.rect(cx0 + 1, crateTop + 5, cw, 1, lv.cargo >= 4 ? 0xffd23f : 0x6b4a2e);

  // exhaust stacks behind the cabin
  const stacks = lv.engine >= 3 ? 2 : 1;
  for (let k = 0; k < stacks; k++) {
    const x = 12 + k * 3;
    const top = 3 - lv.engine * 0.3;
    p.rect(x, Math.round(top), 2, 12, k ? 0x8a8f9a : 0xb4bac4);
    p.rect(x, Math.round(top), 2, 1, 0x3a3d45);
    p.set(x, Math.round(top) + 1, 0xe8eef6);
  }

  // tracks
  p.rect(8, 23, 28, 8, 0x2a2830);
  p.ellipse(9, 27, 3.5, 4, 0x2a2830);
  p.ellipse(35, 27, 3.5, 4, 0x2a2830);
  for (let x = 7; x < 37; x++) if ((x + treadFrame) % 3 === 0) {
    p.set(x, 23, 0x4a4652);
    p.set(x, 30, 0x4a4652);
  }
  for (const wx of [11, 17.5, 24, 30.5]) {
    p.circle(wx, 27, 2.8, 0x8a8f9a);
    p.circle(wx - 0.4, 26.6, 1.6, 0xc4c9d2);
    p.set(Math.round(wx - 0.5), 27, 0x3a3d45);
  }

  // chassis
  p.rect(9, 15, 27, 9, hullDark);
  p.rect(9, 15, 27, 7, hullCol);
  p.rect(9, 15, 27, 1, hullLight);
  p.rect(10, 21, 25, 1, shade(hullCol, -0.15));
  // hazard stripe on the nose
  for (let x = 29; x < 36; x++) for (let y = 17; y < 21; y++) if ((x + y) % 4 < 2) p.set(x, y, 0x2a2228);
  // armour plates with rivets
  if (lv.hull >= 1) {
    const plates = Math.min(3, Math.ceil(lv.hull / 2));
    for (let k = 0; k < plates; k++) {
      const x = 11 + k * 6;
      p.rect(x, 17, 5, 4, lv.hull >= 5 ? 0xd9b45a : 0x9aa3ad);
      p.rect(x, 17, 5, 1, lv.hull >= 5 ? 0xffe9a8 : 0xd6dde4);
      p.set(x + 1, 19, 0x3a3d45);
      p.set(x + 3, 19, 0x3a3d45);
    }
  }
  // headlight
  p.rect(35, 16, 2, 3, 0xfff6c8);
  p.set(36, 16, 0xffffff);

  // cabin
  p.rect(14, 4, 14, 12, hullDark);
  p.rect(15, 5, 12, 11, hullCol);
  p.rect(15, 5, 12, 1, hullLight);
  p.set(14, 4, 0);
  p.set(27, 4, 0);
  // window with a little pilot
  p.rect(18, 6, 9, 7, 0x2b5f7a);
  p.rect(18, 6, 9, 3, 0x7fe0ff);
  p.rect(18, 9, 9, 1, 0x5fb8da);
  p.circle(22, 10.5, 2.2, 0xff8a3d);
  p.rect(21, 9, 3, 2, 0x2a2228);
  p.set(22, 9, 0x9ff0ff);
  p.line(19, 12, 21, 6, 0xd8f6ff);
  p.line(20, 12, 22, 7, 0xb8ecff);

  // radiator fins
  const fins = 2 + lv.cooling;
  const finCol: RGB = lv.cooling >= 4 ? 0x7fd8ff : 0xb4bac4;
  for (let k = 0; k < fins; k++) {
    const x = 28 + k;
    if (x > 35) break;
    const h = 4 + (k % 2);
    p.rect(x, 15 - h, 1, h, k % 2 ? shade(finCol, -0.25) : finCol);
  }
  if (lv.cooling >= 4) p.rect(28, 10, Math.min(8, fins), 1, 0xd8f6ff);

  // scanner dish on the roof
  if (lv.scanner >= 1) {
    p.rect(20, 1, 1, 3, 0x8a8f9a);
    p.ellipse(20.5, 1.5, 3, 1.5, 0xd6dde4);
    p.set(20, 0, lv.scanner >= 3 ? 0x7dff8a : 0xff5050);
  }
  // recall winch hook on the crate
  if (lv.recall >= 1) {
    p.rect(cx0 + 2, crateTop - 2, 3, 2, 0x8a8f9a);
    p.set(cx0 + 3, crateTop - 3, 0xffd23f);
  }

  p.outline(INK);
  return p;
}

/** tiers of drill bit look: steel, hardened, gold, crystal, void */
const DRILL_LOOKS: { col: RGB; len: number; glow: RGB | null }[] = [
  { col: 0xb4bac4, len: 11, glow: null },
  { col: 0xc9d0da, len: 13, glow: null },
  { col: 0xf2c14e, len: 14, glow: null },
  { col: 0x8ff0ff, len: 16, glow: 0x8ff0ff },
  { col: 0xc89bff, len: 17, glow: 0xc89bff },
];

export const drillLook = (drillLevel: number) => DRILL_LOOKS[Math.min(DRILL_LOOKS.length - 1, Math.floor(drillLevel / 2))];

/** drill bit pointing right; four spin frames */
export function paintDrill(drillLevel: number, frame: number): Pix {
  const look = drillLook(drillLevel);
  const p = new Pix(24, 16);
  const len = look.len;
  const cy = 8;
  // collar
  p.rect(0, 2, 4, 12, 0x5a5f6a);
  p.rect(0, 2, 4, 1, 0x9aa1ad);
  p.rect(1, 4, 2, 8, 0x3a3d45);
  // cone
  for (let x = 0; x <= len; x++) {
    const half = 6 * (1 - x / (len + 1));
    for (let y = Math.round(cy - half); y <= Math.round(cy + half); y++) {
      const ridge = (x * 2 + (y - cy) * 3 + frame * 3) % 8;
      let c = ridge < 2 ? shade(look.col, 0.45) : ridge < 5 ? look.col : shade(look.col, -0.35);
      if (y > cy + half - 1.2) c = shade(c, -0.25);
      p.set(4 + x, y, c);
    }
  }
  p.set(4 + len, cy, 0xffffff);
  p.outline(INK);
  return p;
}

/** flame under the pod while thrusting; colour follows the engine level */
export function paintFlame(engineLevel: number, frame: number): Pix {
  const p = new Pix(12, 16);
  const hot = engineLevel >= 4 ? 0x9fdcff : 0xffe07a;
  const mid = engineLevel >= 4 ? 0x4f8cff : 0xff8a2a;
  const cool = engineLevel >= 4 ? 0x7a4fff : 0xd8402a;
  const len = 9 + (frame % 3) * 2;
  for (let y = 0; y < len; y++) {
    const half = 4.2 * (1 - y / len) + (frame === 1 && y < 4 ? 0.6 : 0);
    for (let x = Math.round(6 - half); x <= Math.round(5.5 + half); x++) {
      const t = Math.abs(x - 5.75) / (half + 0.01);
      p.set(x, y, y < len * 0.35 && t < 0.5 ? 0xffffff : t < 0.45 ? hot : t < 0.8 ? mid : cool);
    }
  }
  return p;
}

/** a plain glow disc, used for headlights, ore shine, heat */
export function paintGlow(size: number, col: RGB, power = 2): Pix {
  const p = new Pix(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
      if (d >= 1) continue;
      const a = Math.pow(1 - d, power);
      p.set(x, y, col, Math.round(a * 255));
    }
  return p;
}

export const lerpCol = mix;
