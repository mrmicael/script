// Landmark art. The same shapes the generator rasterised into tiles are drawn
// here at full resolution: `front` sits over the solid cells (and disappears
// tile by tile as they are drilled), `back` is painted on the cave wall.

import { DOOR_STAMP, LANDMARKS, WAYSTATION_STAMP, primContains, type LandmarkDef, type Prim } from '../../core/landmarks';
import { Pix, mix, n01, shade, type RGB } from '../paint';

const T = 32;
const INK = 0x1a1420;

function fillPrim(p: Pix, prim: Prim, col: (x: number, y: number) => RGB | null): void {
  // bounding box in pixels
  let x0 = 0;
  let y0 = 0;
  let x1 = p.w;
  let y1 = p.h;
  if (prim.k === 'ellipse') [x0, y0, x1, y1] = [(prim.cx - prim.rx) * T, (prim.cy - prim.ry) * T, (prim.cx + prim.rx) * T, (prim.cy + prim.ry) * T];
  else if (prim.k === 'rect') [x0, y0, x1, y1] = [prim.x0 * T, prim.y0 * T, prim.x1 * T, prim.y1 * T];
  else if (prim.k === 'capsule')
    [x0, y0, x1, y1] = [(Math.min(prim.ax, prim.bx) - prim.r) * T, (Math.min(prim.ay, prim.by) - prim.r) * T, (Math.max(prim.ax, prim.bx) + prim.r) * T, (Math.max(prim.ay, prim.by) + prim.r) * T];
  else {
    const xs = prim.pts.filter((_, i) => i % 2 === 0);
    const ys = prim.pts.filter((_, i) => i % 2 === 1);
    [x0, y0, x1, y1] = [Math.min(...xs) * T, Math.min(...ys) * T, Math.max(...xs) * T, Math.max(...ys) * T];
  }
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(p.h, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(p.w, Math.ceil(x1)); x++) {
      if (!primContains(prim, (x + 0.5) / T, (y + 0.5) / T)) continue;
      const c = col(x, y);
      if (c !== null) p.set(x, y, c);
    }
  }
}

/** keep art only inside cells that the generator marked (front art never floats over air) */
function clipToCells(p: Pix, lm: LandmarkDef, keep: (lx: number, ly: number) => boolean): void {
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (!keep(Math.floor(x / T), Math.floor(y / T))) p.clearPx(x, y);
  void lm;
}

function bones(lm: LandmarkDef): Pix {
  const p = new Pix(lm.w * T, lm.h * T);
  for (const op of lm.ops) if (op.decor) fillPrim(p, op.prim, () => 0xf4ead2);
  p.rimLight(0xffffff, 0xb8a47c, 0.55);
  // cracks and porous dots
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(n01(i, 1, 41) * p.w);
    const y = Math.floor(n01(i, 2, 41) * p.h);
    if (p.alpha(x, y) && p.alpha(x + 1, y)) p.set(x, y, 0xcbb994);
  }
  p.outline(0x4a3622);
  // the eye socket
  const skull = lm.ops.find((o) => o.prim.k === 'ellipse')!.prim as Extract<Prim, { k: 'ellipse' }>;
  p.ellipse(skull.cx * T + 6, skull.cy * T - 4, 5, 4, 0x4a3622);
  p.ellipse(skull.cx * T + 30, skull.cy * T + 10, 3, 2, 0x4a3622);
  return p;
}

function crystals(lm: LandmarkDef, front: boolean): Pix {
  const p = new Pix(lm.w * T, lm.h * T);
  if (front) {
    lm.ops.forEach((op, k) => {
      if (!op.decor) return;
      if (op.prim.k !== 'poly') {
        fillPrim(p, op.prim, (x, y) => (n01(x >> 2, y >> 2, 3) > 0.5 ? 0x5f5894 : 0x4b4580));
        return;
      }
      const pts = op.prim.pts;
      const tipX = pts[4] * T;
      const col = k % 3 === 0 ? 0x5fa8ff : 0xb06bff;
      fillPrim(p, op.prim, (x, y) => {
        const left = x < tipX;
        const band = Math.floor((y + x * 0.3) / 18) % 2;
        let c = left ? shade(col, 0.25) : shade(col, -0.2);
        if (band) c = mix(c, 0xffffff, 0.08);
        if (Math.abs(x - tipX) < 1.5) c = shade(col, 0.6);
        return c;
      });
    });
    p.outline(0x1c1638);
  } else {
    // a soft violet glow and far crystal silhouettes on the wall
    const cx = p.w / 2;
    const cy = p.h * 0.55;
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const d = Math.hypot((x - cx) / p.w, (y - cy) / p.h);
        const base = mix(0x2a2350, 0x120e26, Math.min(1, d * 1.6));
        p.set(x, y, n01(x >> 3, y >> 3, 9) > 0.85 ? shade(base, 0.08) : base);
      }
    for (let i = 0; i < 14; i++) {
      const x = n01(i, 1, 77) * p.w;
      const h = 60 + n01(i, 2, 77) * 140;
      const w = 10 + n01(i, 3, 77) * 16;
      const base = p.h - 30;
      p.poly([x - w, base, x, base - h, x + w, base], 0x3b3570, 255);
      p.line(x, base - h + 4, x - w * 0.4, base, 0x5f5894);
    }
  }
  return p;
}

function train(lm: LandmarkDef, front: boolean): Pix {
  const p = new Pix(lm.w * T, lm.h * T);
  if (front) {
    for (const op of lm.ops) {
      if (!op.decor) continue;
      fillPrim(p, op.prim, (x, y) => {
        const yy = y / T;
        if (yy < 1.2) return 0x5f8f8c;
        if (yy > 5.8) return 0x34514f;
        if (Math.abs(yy - 3.3) < 0.18) return 0xf2c14e;
        return n01(x >> 4, y >> 4, 5) > 0.7 ? 0x6fa39f : 0x7fb5b0;
      });
    }
    p.rimLight(0xc8f0ea, 0x1f3533, 0.6);
    // windows along each car, wheels, a lamp on the locomotive
    const cars = [
      [0.5, 12.5],
      [13.5, 24.5],
      [25.5, 35.5],
    ];
    for (const [a, b] of cars) {
      for (let x = a + 1.5; x < b - 1.5; x += 2) {
        p.rect(Math.round(x * T), Math.round(1.9 * T), 34, 26, 0x1c2a2a);
        p.rect(Math.round(x * T) + 2, Math.round(1.9 * T) + 2, 30, 22, 0x2f6f6a);
        p.rect(Math.round(x * T) + 2, Math.round(1.9 * T) + 2, 30, 6, 0x7ff0e0);
      }
      for (const x of [a + 1.5, a + 3.5, b - 3.5, b - 1.5]) {
        p.circle(x * T, 6.6 * T, 14, 0x1c1c22);
        p.circle(x * T, 6.6 * T, 9, 0x5a5f6a);
        p.circle(x * T, 6.6 * T, 3, 0x1c1c22);
      }
    }
    p.circle(0.9 * T, 3.6 * T, 9, 0xfff6c8);
    p.circle(0.9 * T, 3.6 * T, 5, 0xffffff);
    clipToCells(p, lm, (lx, ly) => lm.ops.some((o) => o.decor && o.prim && primContains(o.prim, lx + 0.5, ly + 0.5)));
    p.outline(INK);
  } else {
    // inside the cars: wall panels and benches
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const panel = Math.floor(x / 48) % 2;
        p.set(x, y, panel ? 0x24302e : 0x2a3836);
      }
    for (let x = 40; x < p.w - 40; x += 64) {
      p.rect(x, 5 * T - 8, 40, 8, 0x5a3a2a);
      p.rect(x, 4 * T, 6, T, 0x5a3a2a);
    }
  }
  return p;
}

function lake(lm: LandmarkDef, front: boolean): Pix {
  const p = new Pix(lm.w * T, lm.h * T);
  if (front) {
    for (const op of lm.ops) {
      if (!op.decor) continue;
      fillPrim(p, op.prim, (x, y) => ((x + y) % 23 < 3 ? 0xeefaff : n01(x >> 3, y >> 3, 8) > 0.6 ? 0xbfe6f8 : 0xa6dcf4));
    }
    // a frozen mammoth inside the ice block
    const e = lm.ops.find((o) => o.decor && o.prim.k === 'ellipse')!.prim as Extract<Prim, { k: 'ellipse' }>;
    const mx = e.cx * T;
    const my = e.cy * T;
    const fur = 0x7a5a4a;
    p.ellipse(mx, my, 40, 26, fur, 200);
    p.ellipse(mx + 34, my - 8, 18, 16, fur, 200);
    for (const lx of [-26, -10, 12, 26]) p.rect(mx + lx, my + 14, 10, 24, shade(fur, -0.2), 200);
    p.thick(mx + 44, my + 4, mx + 50, my + 26, 3, fur, 200);
    p.thick(mx + 40, my + 6, mx + 58, my + 14, 2.2, 0xf4ead2, 230);
    p.thick(mx + 58, my + 14, mx + 62, my + 4, 2.2, 0xf4ead2, 230);
    p.circle(mx + 38, my - 12, 2, 0x1a1420);
    clipToCells(p, lm, (lx, ly) => lm.ops.some((o) => o.decor && primContains(o.prim, lx + 0.5, ly + 0.5)));
    p.rimLight(0xffffff, 0x5e9bc4, 0.5);
    p.outline(0x2b4a6a);
  } else {
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const shimmer = Math.sin(x * 0.05 + y * 0.12) > 0.85;
        p.set(x, y, shimmer ? 0x24506e : mix(0x183a54, 0x0e2234, y / p.h));
      }
  }
  return p;
}

function forge(lm: LandmarkDef, front: boolean): Pix {
  const p = new Pix(lm.w * T, lm.h * T);
  if (front) {
    lm.ops.forEach((op, k) => {
      if (!op.decor) return;
      const alloy = k === 5;
      fillPrim(p, op.prim, (x, y) => (alloy ? (y % 10 < 2 ? 0x9fd6cf : 0x5f8f8c) : n01(x >> 3, y >> 3, 6) > 0.6 ? 0x5a4646 : 0x463838));
    });
    p.rimLight(0x8a7070, 0x1a1012, 0.6);
    // the statue's face: a hooded head with glowing eyes
    const s = lm.ops[4].prim as Extract<Prim, { k: 'poly' }>;
    const fx = ((s.pts[2] + s.pts[10]) / 2) * T;
    p.ellipse(fx, 4.6 * T, 40, 46, 0x2c2224);
    p.ellipse(fx, 5 * T, 30, 34, 0x3c3032);
    p.rect(fx - 18, 4.6 * T, 10, 6, 0xffb347);
    p.rect(fx + 8, 4.6 * T, 10, 6, 0xffb347);
    p.rect(fx - 12, 5.6 * T, 24, 3, 0x2c2224);
    // runes on the altar column
    for (let i = 0; i < 4; i++) p.rect(11.2 * T + (i % 2) * 20, 7 * T + i * 26, 14, 4, 0xff7a2a);
    clipToCells(p, lm, (lx, ly) => lm.ops.some((o) => o.decor && primContains(o.prim, lx + 0.5, ly + 0.5)));
    p.outline(INK);
  } else {
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const brick = (Math.floor(y / 16) % 2 ? x + 16 : x) % 32 === 0 || y % 16 === 0;
        p.set(x, y, brick ? 0x1c0c0a : mix(0x4a1a12, 0x2a0c08, y / p.h));
      }
    for (let i = 0; i < 6; i++) {
      const x = 80 + i * 100;
      p.rect(x, 40, 12, 20, 0xff7a2a);
      p.rect(x + 3, 44, 6, 12, 0xffe07a);
    }
  }
  return p;
}

function stars(lm: LandmarkDef, front: boolean): Pix {
  const p = new Pix(lm.w * T, lm.h * T);
  if (front) {
    for (const op of lm.ops) {
      if (!op.decor) continue;
      fillPrim(p, op.prim, (x, y) => (Math.sin(x * 0.2 + y * 0.3) > 0.8 ? 0xb89bff : n01(x >> 2, y >> 2, 4) > 0.5 ? 0x42357f : 0x2e2560));
    }
    p.rimLight(0xd8c8ff, 0x140e2a, 0.5);
    p.outline(0x0a0614);
  } else {
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) p.set(x, y, mix(0x1a1236, 0x07050f, Math.hypot(x / p.w - 0.5, y / p.h - 0.5) * 1.5));
    for (let i = 0; i < 160; i++) {
      const x = n01(i, 1, 13) * p.w;
      const y = n01(i, 2, 13) * p.h;
      p.set(x, y, i % 7 ? 0xb8b0ff : 0xffffff);
    }
    // a constellation in the shape of the keystones
    const pts = [
      [0.2, 0.3],
      [0.32, 0.2],
      [0.45, 0.28],
      [0.58, 0.18],
      [0.7, 0.3],
      [0.82, 0.22],
    ];
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      p.circle(x * p.w, y * p.h, 3, 0xffffff);
      if (i) p.line(pts[i - 1][0] * p.w, pts[i - 1][1] * p.h, x * p.w, y * p.h, 0x6b5fa8);
    }
  }
  return p;
}

function door(lm: LandmarkDef, front: boolean): Pix {
  const p = new Pix(lm.w * T, lm.h * T);
  if (front) {
    const r = lm.ops.find((o) => o.decor)!.prim as Extract<Prim, { k: 'rect' }>;
    const x0 = r.x0 * T;
    const y0 = r.y0 * T;
    const w = (r.x1 - r.x0) * T;
    const h = (r.y1 - r.y0) * T;
    p.rect(x0, y0, w, h, 0x8a7036);
    p.rect(x0 + 6, y0 + 6, w - 12, h - 12, 0xc9a24e);
    p.rect(x0 + 6, y0 + 6, w - 12, 3, 0xf4e2a0);
    p.rect(x0 + w / 2 - 1, y0 + 6, 2, h - 12, 0x6a5428);
    // six sockets for the keystones
    for (let i = 0; i < 6; i++) {
      const sx = x0 + 22 + (i % 2) * (w - 44);
      const sy = y0 + 34 + Math.floor(i / 2) * 52;
      p.circle(sx, sy, 10, 0x5a4622);
      p.circle(sx, sy, 7, 0x1c1638);
    }
    p.outline(INK);
  } else {
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const pillar = x % 96 < 14;
        p.set(x, y, pillar ? 0x2a2140 : mix(0x1c1438, 0x0a0614, y / p.h));
      }
    // the heart chamber glows warm
    for (let y = 0; y < p.h; y++)
      for (let x = 18 * T; x < 25 * T; x++) {
        const d = Math.hypot(x - 22 * T, y - 9 * T) / (6 * T);
        if (d < 1) p.set(x, y, mix(0x5a1d14, 0x1c1438, d));
      }
  }
  return p;
}

function waystation(): Pix {
  const { w, h } = WAYSTATION_STAMP;
  const p = new Pix(w * T, h * T);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) p.set(x, y, mix(0x2a3038, 0x161a20, y / p.h));
  // steel frame of the lift shaft
  for (const x of [2 * T - 6, 4 * T]) {
    p.rect(x, 0, 6, p.h, 0x6f7f8f);
    p.rect(x, 0, 2, p.h, 0xb4c4d2);
  }
  for (let y = 10; y < p.h; y += 22) p.thick(2 * T, y, 4 * T, y + 18, 1, 0x4a5560);
  p.rect(3 * T - 1, 0, 2, p.h - T, 0x1c1c22);
  // lamp and an up arrow
  p.circle(T * 1, T * 0.8, 6, 0xffd23f);
  p.circle(T * 1, T * 0.8, 3, 0xffffff);
  p.poly([5 * T, 18, 5 * T + 10, 30, 5 * T + 4, 30, 5 * T + 4, 44, 5 * T - 4, 44, 5 * T - 4, 30, 5 * T - 10, 30], 0x7dff8a);
  return p;
}

export interface LandmarkArt {
  front: Pix | null;
  back: Pix | null;
}

/** art per landmark type, in the same order as decorValue's types */
export function paintLandmarks(): LandmarkArt[] {
  const out: LandmarkArt[] = [];
  for (const lm of LANDMARKS) {
    switch (lm.key) {
      case 'fossil':
        out.push({ front: bones(lm), back: null });
        break;
      case 'cathedral':
        out.push({ front: crystals(lm, true), back: crystals(lm, false) });
        break;
      case 'train':
        out.push({ front: train(lm, true), back: train(lm, false) });
        break;
      case 'lake':
        out.push({ front: lake(lm, true), back: lake(lm, false) });
        break;
      case 'forge':
        out.push({ front: forge(lm, true), back: forge(lm, false) });
        break;
      case 'stars':
        out.push({ front: stars(lm, true), back: stars(lm, false) });
        break;
      default:
        out.push({ front: null, back: null });
    }
  }
  out.push({ front: door(DOOR_STAMP, true), back: door(DOOR_STAMP, false) });
  out.push({ front: null, back: waystation() });
  return out;
}
