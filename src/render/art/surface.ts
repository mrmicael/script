// The surface: sky, far hills, clouds, the workshop, the lift tower, trees.

import { Pix, mix, n01, shade, type RGB } from '../paint';

const INK = 0x1a1420;

export function paintSky(): Pix {
  const p = new Pix(2, 256);
  for (let y = 0; y < 256; y++) {
    const t = y / 255;
    const c = t < 0.6 ? mix(0x5fb4ff, 0x9fd8ff, t / 0.6) : mix(0x9fd8ff, 0xffe6b8, (t - 0.6) / 0.4);
    p.set(0, y, c);
    p.set(1, y, c);
  }
  return p;
}

/** a horizontally tileable ridge line */
export function paintHills(w: number, h: number, base: RGB, top: RGB, seed: number, rough: number): Pix {
  const p = new Pix(w, h);
  for (let x = 0; x < w; x++) {
    const t = (x / w) * Math.PI * 2;
    const y0 = h * (0.35 + 0.18 * Math.sin(t * 2 + seed) + 0.1 * Math.sin(t * 5 + seed * 2) + rough * 0.05 * Math.sin(t * 13 + seed * 3));
    for (let y = Math.max(0, Math.floor(y0)); y < h; y++) {
      const k = (y - y0) / (h - y0);
      p.set(x, y, y - y0 < 2 ? top : mix(base, shade(base, -0.15), k));
    }
  }
  return p;
}

export function paintCloud(w: number, h: number, seed: number): Pix {
  const p = new Pix(w, h);
  const blobs = 5;
  for (let i = 0; i < blobs; i++) {
    const cx = w * (0.18 + (0.64 * i) / (blobs - 1));
    const r = h * (0.28 + n01(i, 1, seed) * 0.2) * (i === 2 ? 1.25 : 1);
    p.ellipse(cx, h * 0.62 - r * 0.4, r * 1.25, r, 0xffffff);
  }
  // flat underside
  for (let y = Math.floor(h * 0.72); y < h; y++) for (let x = 0; x < w; x++) p.clearPx(x, y);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!p.alpha(x, y)) continue;
      if (y > h * 0.6 || !p.alpha(x, y + 2)) p.set(x, y, 0xdfeeff);
    }
  return p;
}

export function paintPine(h: number, seed: number): Pix {
  const w = Math.round(h * 0.62);
  const p = new Pix(w, h);
  const cx = w / 2;
  p.rect(Math.round(cx - 1.5), h - 7, 3, 7, 0x6b4a2e);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const top = 1 + i * (h - 10) * 0.22;
    const bottom = top + (h - 8) * 0.38;
    const half = (w / 2 - 1) * (0.45 + (i / (tiers - 1)) * 0.55);
    const pts = [cx, top, cx + half, bottom, cx + half * 0.3, bottom - 1.5, cx - half * 0.3, bottom - 1.5, cx - half, bottom];
    p.poly(pts, 0x2f6b3a);
    p.poly([cx, top + 1, cx + half - 2, bottom - 1, cx + 0.5, bottom - 2.5], 0x3f8a46);
    p.poly([cx, top + 1, cx - half + 2, bottom - 1, cx - 0.5, bottom - 2.5], 0x5fae52);
    for (let k = 0; k < 3; k++) p.set(cx - half * 0.5 + n01(i, k, seed) * half, bottom - 2 - n01(k, i, seed) * 3, 0x86c95e);
  }
  p.outline(INK);
  return p;
}

export function paintBush(seed: number): Pix {
  const p = new Pix(28, 16);
  p.ellipse(9, 11, 8, 6, 0x3f8a46);
  p.ellipse(18, 10, 9, 7, 0x4e9a4a);
  p.ellipse(15, 8, 6, 5, 0x6cbf52);
  p.rect(0, 15, 28, 1, 0);
  for (let i = 0; i < 5; i++) p.set(5 + n01(i, 1, seed) * 18, 5 + n01(i, 2, seed) * 6, i % 2 ? 0xffd23f : 0xff7aa8);
  p.outline(INK);
  return p;
}

/** the workshop: 7 x 5 tiles */
export function paintWorkshop(): Pix {
  const W = 224;
  const H = 160;
  const p = new Pix(W, H);
  const wall = 0xc98a5a;
  const wallDark = 0x8a5634;
  // walls with planks
  p.rect(10, 50, 204, 110, wallDark);
  p.rect(12, 52, 200, 106, wall);
  for (let y = 58; y < 158; y += 8) p.rect(12, y, 200, 1, shade(wall, -0.18));
  for (let i = 0; i < 40; i++) p.set(14 + n01(i, 1, 3) * 196, 54 + n01(i, 2, 3) * 100, shade(wall, 0.2));
  // roof
  p.poly([0, 54, 30, 14, 194, 14, 224, 54], 0x8a2f2a);
  p.poly([4, 52, 32, 17, 192, 17, 220, 52], 0xc0443a);
  for (let y = 22; y < 52; y += 6) p.rect(Math.round(30 - (y - 17) * 0.8), y, Math.round(164 + (y - 17) * 1.6), 1, 0x9a3530);
  p.rect(30, 14, 164, 3, 0xe06a52);
  // chimney
  p.rect(160, 0, 16, 26, 0x6e5a5a);
  p.rect(158, 0, 20, 5, 0x4a3a3a);
  // big garage door
  p.rect(56, 82, 112, 76, 0x3a2e2a);
  p.rect(60, 86, 104, 72, 0x6f8fa8);
  for (let y = 92; y < 158; y += 10) {
    p.rect(60, y, 104, 1, 0x4a6378);
    p.rect(60, y + 1, 104, 1, 0x9fbcd0);
  }
  p.rect(60, 86, 104, 2, 0xc4dcec);
  // hazard header over the door
  for (let x = 56; x < 168; x++) for (let y = 74; y < 82; y++) p.set(x, y, (x + y) % 12 < 6 ? 0xffd23f : 0x2a2228);
  // windows, warm light
  for (const x of [20, 178]) {
    p.rect(x, 70, 26, 22, 0x4a3022);
    p.rect(x + 2, 72, 22, 18, 0xffd98a);
    p.rect(x + 2, 72, 22, 6, 0xfff2c8);
    p.rect(x + 12, 72, 2, 18, 0x4a3022);
    p.rect(x + 2, 80, 22, 2, 0x4a3022);
  }
  // sign: a big wrench + gear emblem
  p.rect(84, 26, 56, 26, 0x4a3022);
  p.rect(86, 28, 52, 22, 0xf4ead2);
  p.circle(102, 39, 7, 0x5a5f6a);
  p.circle(102, 39, 3, 0xf4ead2);
  for (let a = 0; a < 8; a++) {
    const t = (a / 8) * Math.PI * 2;
    p.circle(102 + Math.cos(t) * 7.5, 39 + Math.sin(t) * 7.5, 2, 0x5a5f6a);
  }
  p.thick(114, 46, 128, 32, 2, 0xc0443a);
  p.circle(129, 31, 4, 0xc0443a);
  p.circle(130, 30, 1.8, 0xf4ead2);
  // tools hanging on the wall and barrels
  p.rect(178, 128, 16, 30, 0x2b6f8a);
  p.rect(178, 128, 16, 3, 0x7fe9ff);
  p.rect(196, 134, 14, 24, 0xc0443a);
  p.rect(196, 134, 14, 3, 0xff8a6a);
  p.rect(20, 120, 26, 4, 0x6b4a2e);
  p.thick(24, 112, 28, 120, 1, 0x8a8f9a);
  p.thick(38, 110, 36, 120, 1, 0x8a8f9a);
  p.outline(INK);
  return p;
}

/** the lift tower above the main elevator: 4 x 7 tiles */
export function paintLiftTower(): Pix {
  const W = 128;
  const H = 224;
  const p = new Pix(W, H);
  const steel = 0x6f7f8f;
  const light = 0xb4c4d2;
  for (const x of [14, 106]) {
    p.rect(x, 20, 8, 204, steel);
    p.rect(x, 20, 2, 204, light);
  }
  for (let y = 28; y < 220; y += 24) {
    p.thick(18, y, 110, y + 22, 1, steel);
    p.thick(110, y, 18, y + 22, 1, shade(steel, -0.2));
    p.rect(14, y, 100, 3, steel);
  }
  // wheel house
  p.rect(6, 0, 116, 26, 0x4a5560);
  p.rect(8, 2, 112, 20, 0x8a9aa8);
  p.circle(64, 13, 11, 0x3a4450);
  p.circle(64, 13, 8, 0xc4ccd4);
  p.circle(64, 13, 3, 0x3a4450);
  p.rect(63, 22, 2, 202, 0x2a2a30);
  // warning lamp
  p.circle(116, 6, 4, 0xff5050);
  p.circle(115, 5, 1.5, 0xffd0d0);
  p.outline(INK);
  return p;
}

export function paintSignpost(): Pix {
  const p = new Pix(40, 44);
  p.rect(18, 14, 4, 30, 0x6b4a2e);
  p.rect(2, 4, 36, 16, 0x8a5634);
  p.rect(3, 5, 34, 14, 0xc98a5a);
  // a down arrow
  p.poly([20, 18, 12, 10, 17, 10, 17, 6, 23, 6, 23, 10, 28, 10], 0xc0443a);
  p.outline(INK);
  return p;
}
