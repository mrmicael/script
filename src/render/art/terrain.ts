// Terrain tiles, painted at boot. Each material gets 16 edge variants (which
// sides open onto a tunnel) x 2 noise variants, so tunnels read as carved:
// ragged lips, rounded corners, light on top edges and shadow under ledges.

import { BIOMES } from '../../core/balance';
import { M, MATERIALS, MATERIAL_COUNT } from '../../core/materials';
import { Pix, Sheet, mix, n01, shade, type RGB } from '../paint';

export const TILE = 32;
export const VARIANTS = 2;
/** frames per material in the terrain sheet */
export const FRAMES_PER_MAT = 16 * VARIANTS;

export const terrainFrame = (mat: number, mask: number, variant: number): number => mat * FRAMES_PER_MAT + mask * VARIANTS + variant;

const T = TILE;

type BasePainter = (p: Pix, v: number, seed: number) => void;

function speckle(p: Pix, cols: RGB[], seed: number, density = 0.18, blob = 0.5): void {
  const [light, mid, dark] = cols;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const n = n01(x >> 1, y >> 1, seed) * 0.6 + n01(x, y, seed + 3) * 0.4;
      let c = mid;
      if (n > 1 - density * 0.6) c = light;
      else if (n < density * blob) c = dark;
      p.set(x, y, c);
    }
  }
}

function pebbles(p: Pix, cols: RGB[], seed: number, count: number, rmin: number, rmax: number): void {
  for (let i = 0; i < count; i++) {
    const cx = 3 + n01(i, 1, seed) * (T - 6);
    const cy = 3 + n01(i, 2, seed) * (T - 6);
    const r = rmin + n01(i, 3, seed) * (rmax - rmin);
    p.ellipse(cx, cy, r * 1.2, r, cols[2]);
    p.ellipse(cx - 0.4, cy - 0.5, r * 1.2 - 0.6, r - 0.6, cols[1]);
    p.set(Math.round(cx - r * 0.5), Math.round(cy - r * 0.5), cols[0]);
  }
}

/** cobbles: a few rounded stones with lit tops and dark seams */
function cobbles(p: Pix, cols: RGB[], seed: number, cells: number): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < cells; i++) pts.push([n01(i, 7, seed) * T, n01(i, 9, seed) * T]);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let id = 0;
      for (let i = 0; i < pts.length; i++) {
        for (const ox of [-T, 0, T]) {
          for (const oy of [-T, 0, T]) {
            const dx = x - pts[i][0] - ox;
            const dy = y - pts[i][1] - oy;
            const d = dx * dx + dy * dy;
            if (d < d1) {
              d2 = d1;
              d1 = d;
              id = i;
            } else if (d < d2) d2 = d;
          }
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const tone = n01(id, 5, seed);
      let c = mix(cols[1], tone > 0.5 ? cols[0] : cols[2], Math.abs(tone - 0.5) * 0.7);
      if (edge < 1.2) c = cols[2];
      else if (edge < 2.4) {
        // the lit side of each stone faces up-left
        const [px, py] = pts[id];
        c = y < py || x < px ? mix(c, cols[0], 0.45) : mix(c, cols[2], 0.35);
      }
      if (n01(x, y, seed + 11) > 0.93) c = shade(c, -0.12);
      p.set(x, y, c);
    }
  }
}

const BASE: Partial<Record<M, BasePainter>> = {
  [M.DIRT]: (p, v, s) => {
    const c = MATERIALS[M.DIRT].colors;
    speckle(p, c, s, 0.2);
    pebbles(p, [0xc99a6a, 0x9a6b45, 0x5e3a24], s + v, 2, 1.2, 2);
  },
  [M.GRASS]: (p, v, s) => {
    const c = MATERIALS[M.DIRT].colors;
    speckle(p, c, s, 0.2);
    pebbles(p, [0xc99a6a, 0x9a6b45, 0x5e3a24], s + v, 1, 1.2, 1.8);
  },
  [M.CLAY]: (p, _v, s) => {
    const c = MATERIALS[M.CLAY].colors;
    for (let y = 0; y < T; y++) {
      const band = Math.sin((y + n01(0, y >> 2, s) * 3) * 0.55) > 0.55;
      for (let x = 0; x < T; x++) {
        let col = band ? c[0] : c[1];
        const n = n01(x, y, s);
        if (n > 0.9) col = c[0];
        else if (n < 0.08) col = c[2];
        p.set(x, y, col);
      }
    }
  },
  [M.SAND]: (p, _v, s) => {
    const c = MATERIALS[M.SAND].colors;
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const n = n01(x, y, s);
        const ripple = Math.sin(x * 0.45 + y * 0.9 + n01(x >> 3, y >> 3, s) * 4) > 0.75;
        p.set(x, y, n > 0.88 ? c[0] : n < 0.1 || ripple ? mix(c[1], c[2], 0.35) : c[1]);
      }
  },
  [M.STONE]: (p, _v, s) => cobbles(p, MATERIALS[M.STONE].colors, s, 5),
  [M.GRANITE]: (p, _v, s) => {
    cobbles(p, MATERIALS[M.GRANITE].colors, s, 4);
    for (let i = 0; i < 26; i++) p.set(n01(i, 1, s + 4) * T, n01(i, 2, s + 4) * T, i % 3 ? 0x2a2026 : 0xf0e6e8);
  },
  [M.CRYSTAL_ROCK]: (p, v, s) => {
    const c = MATERIALS[M.CRYSTAL_ROCK].colors;
    speckle(p, [c[1], mix(c[1], c[2], 0.4), c[2]], s, 0.25);
    // small embedded shards catch the light
    for (let i = 0; i < 3 + v; i++) {
      const x = 4 + n01(i, 3, s) * 24;
      const y = 4 + n01(i, 4, s) * 24;
      p.poly([x, y + 3, x + 2, y - 3, x + 4, y + 3], 0x6a5fb0);
      p.line(x + 2, y - 2, x + 2, y + 2, 0xb8b0ff);
      p.set(x + 2, y - 2, 0xffffff);
    }
  },
  [M.SLATE]: (p, _v, s) => {
    const c = MATERIALS[M.SLATE].colors;
    for (let y = 0; y < T; y++) {
      const layer = Math.floor((y + n01(0, 1, s) * 4) / 5);
      for (let x = 0; x < T; x++) {
        const off = n01(layer, 3, s) * 10;
        const seam = (y + n01(0, 1, s) * 4) % 5 < 1;
        const crack = Math.floor((x + off) / 11) !== Math.floor((x + off + 1) / 11);
        let col = n01(layer, 2, s) > 0.5 ? c[1] : mix(c[1], c[0], 0.3);
        if (seam) col = c[2];
        else if (crack) col = mix(c[2], c[1], 0.4);
        else if ((y + n01(0, 1, s) * 4) % 5 < 2) col = mix(col, c[0], 0.35);
        if (n01(x, y, s + 9) > 0.94) col = shade(col, 0.1);
        p.set(x, y, col);
      }
    }
  },
  [M.BRICK]: (p, _v, s) => {
    const c = MATERIALS[M.BRICK].colors;
    for (let y = 0; y < T; y++) {
      const row = Math.floor(y / 8);
      for (let x = 0; x < T; x++) {
        const off = row % 2 ? 8 : 0;
        const bx = (x + off) % 16;
        const mortar = y % 8 === 7 || bx === 15;
        let col = mortar ? c[2] : mix(c[1], n01(Math.floor((x + off) / 16), row, s) > 0.5 ? c[0] : c[2], 0.25);
        if (!mortar && (y % 8 === 0 || bx === 0)) col = mix(col, c[0], 0.4);
        if (!mortar && n01(x, y, s) > 0.92) col = shade(col, -0.18);
        // moss in the seams
        if (mortar && n01(x, y, s + 2) > 0.75) col = 0x4f6b3a;
        p.set(x, y, col);
      }
    }
  },
  [M.ALLOY]: (p, _v, s) => {
    const c = MATERIALS[M.ALLOY].colors;
    p.rect(0, 0, T, T, c[1]);
    for (const [x0, y0, w, h] of [
      [0, 0, 16, 16],
      [16, 0, 16, 16],
      [0, 16, 16, 16],
      [16, 16, 16, 16],
    ]) {
      p.rect(x0 + 1, y0 + 1, w - 2, h - 2, mix(c[1], c[0], 0.25));
      p.rect(x0 + 1, y0 + 1, w - 2, 1, c[0]);
      p.rect(x0 + 1, y0 + h - 2, w - 2, 1, c[2]);
      p.set(x0 + 3, y0 + 3, c[2]);
      p.set(x0 + w - 4, y0 + 3, c[2]);
    }
    // a glowing conduit
    if (n01(1, 1, s) > 0.4) p.rect(0, 15, T, 2, 0x5ff0d8);
  },
  [M.ICE]: (p, _v, s) => {
    const c = MATERIALS[M.ICE].colors;
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const g = (x + y + n01(x >> 2, y >> 2, s) * 6) % 14;
        p.set(x, y, g < 2 ? c[0] : g < 7 ? mix(c[1], c[0], 0.3) : c[1]);
      }
    for (let i = 0; i < 2; i++) {
      const x = 6 + n01(i, 1, s) * 20;
      const y = 6 + n01(i, 2, s) * 20;
      p.line(x, y, x + 6, y + 3, c[2]);
      p.line(x + 6, y + 3, x + 9, y + 1, c[2]);
    }
  },
  [M.PERMAFROST]: (p, v, s) => {
    const c = MATERIALS[M.PERMAFROST].colors;
    speckle(p, c, s, 0.22);
    pebbles(p, [0xdff3ff, 0x95aec0, 0x4a5d70], s + v, 2, 1.5, 2.5);
    for (let i = 0; i < 10; i++) p.set(n01(i, 3, s) * T, n01(i, 4, s) * T, 0xffffff);
  },
  [M.BASALT]: (p, _v, s) => {
    const c = MATERIALS[M.BASALT].colors;
    // columns
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const col = Math.floor(x / 8);
        const local = x % 8;
        const joint = (y + Math.floor(n01(col, 1, s) * 16)) % 16 === 0;
        let colr = local === 0 ? c[2] : local === 1 ? mix(c[1], c[0], 0.5) : c[1];
        if (joint) colr = c[2];
        if (n01(x, y, s) > 0.93) colr = shade(colr, 0.12);
        p.set(x, y, colr);
      }
  },
  [M.MAGMA_ROCK]: (p, _v, s) => {
    const c = MATERIALS[M.BASALT].colors;
    speckle(p, [c[1], mix(c[1], c[2], 0.5), c[2]], s, 0.2);
    // glowing veins
    let x = n01(1, 1, s) * 8;
    let y = 0;
    for (let i = 0; i < 40; i++) {
      p.set(x, y, 0xffb347);
      p.set(x + 1, y, 0xe0522a);
      x += n01(i, 3, s) > 0.5 ? 1 : 0;
      y += 1;
      if (y >= T) {
        y = 0;
        x += 9;
      }
    }
    for (let i = 0; i < 6; i++) p.set(n01(i, 5, s) * T, n01(i, 6, s) * T, 0xffe07a);
  },
  [M.VOIDSTONE]: (p, _v, s) => {
    const c = MATERIALS[M.VOIDSTONE].colors;
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const n = n01(x >> 2, y >> 2, s) * 0.5 + n01(x >> 1, y >> 1, s + 1) * 0.5;
        p.set(x, y, n > 0.7 ? c[1] : n < 0.3 ? c[2] : mix(c[2], c[1], 0.5));
      }
    for (let i = 0; i < 5; i++) {
      const x = n01(i, 1, s) * T;
      const y = n01(i, 2, s) * T;
      p.set(x, y, 0xf0d0ff);
      if (i % 2) {
        p.set(x + 1, y, 0x9a83ff);
        p.set(x - 1, y, 0x9a83ff);
        p.set(x, y + 1, 0x9a83ff);
        p.set(x, y - 1, 0x9a83ff);
      }
    }
  },
  [M.BEDROCK]: (p, _v, s) => {
    const c = MATERIALS[M.BEDROCK].colors;
    cobbles(p, c, s, 4);
    for (let i = 0; i < 3; i++) p.line(n01(i, 1, s) * T, n01(i, 2, s) * T, n01(i, 3, s) * T, n01(i, 4, s) * T, 0x0c0b0f);
  },
  [M.FOSSIL]: (p, _v, s) => speckle(p, [0xa7764c, 0x7f5432, 0x553621], s, 0.2),
  [M.VENT]: (p, _v, s) => {
    cobbles(p, MATERIALS[M.STONE].colors, s, 4);
    p.ellipse(16, 17, 8, 6, 0x2a1a14);
    p.ellipse(16, 18, 6, 4, 0x5c3424);
    p.ellipse(16, 19, 4, 2.5, 0xd9773a);
    p.ellipse(16, 19.5, 2, 1.2, 0xffd27a);
    for (let i = 0; i < 8; i++) p.set(10 + n01(i, 1, s) * 12, 9 + n01(i, 2, s) * 4, 0x3a3030);
  },
  [M.BLAST]: (p, _v, s) => {
    const c = MATERIALS[M.BLAST].colors;
    speckle(p, [0x8a4c3a, 0x6b3528, 0x3a1a16], s, 0.2);
    // a pressurised gas crystal: rounded, with a hazard glow
    p.ellipse(16, 16, 9, 8, c[2]);
    p.ellipse(16, 16, 7.5, 6.5, c[1]);
    p.ellipse(15, 14.5, 4.5, 3.5, c[0]);
    p.ellipse(14, 13, 1.6, 1.2, 0xffe2c8);
    for (const [x, y] of [
      [6, 9],
      [25, 22],
      [23, 7],
      [8, 24],
    ])
      p.line(16, 16, x, y, 0x2a0e0c);
  },
  [M.ROOTS]: (p, _v, s) => {
    speckle(p, MATERIALS[M.DIRT].colors, s, 0.2);
    let x = 4 + n01(1, 1, s) * 8;
    for (let y = 0; y < T; y++) {
      p.set(x, y, 0xd8b07a);
      p.set(x + 1, y, 0x8f6338);
      x += n01(2, y, s) > 0.6 ? 1 : n01(3, y, s) > 0.7 ? -1 : 0;
      if (y === 14) for (let k = 0; k < 9; k++) p.set(x + k, y + (k >> 2), 0xb48651);
    }
  },
  [M.PAD]: (p) => {
    p.rect(0, 0, T, T, 0x3a4450);
    p.rect(0, 0, T, 6, 0x8a9aa8);
    p.rect(0, 0, T, 1, 0xd6e2ea);
    for (let x = 0; x < T; x++) for (let y = 2; y < 5; y++) if ((x + y) % 8 < 4) p.set(x, y, 0xffd23f);
    for (let x = 3; x < T; x += 8) p.rect(x, 10, 2, 2, 0x1c2228);
    p.rect(0, 20, T, 1, 0x2a323a);
  },
  [M.DOOR]: (p) => {
    p.rect(0, 0, T, T, 0x8a7036);
    p.rect(1, 1, T - 2, T - 2, 0xa88b45);
    p.rect(1, 1, T - 2, 1, 0xe8d48a);
  },
};

/** liquids are drawn as translucent fills with a lit surface */
function paintLiquid(p: Pix, m: M, mask: number, s: number): void {
  const water = m === M.WATER;
  const [light, mid, dark] = MATERIALS[m].colors;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const wave = Math.sin(x * 0.4 + y * 0.25 + n01(x >> 3, y >> 3, s) * 3);
      let c = wave > 0.6 ? mix(mid, light, 0.35) : wave < -0.7 ? mix(mid, dark, 0.4) : mid;
      if (!water && n01(x >> 1, y >> 1, s) > 0.86) c = light;
      p.set(x, y, c, water ? 150 : 255);
    }
  }
  if (mask & 1) {
    // surface line
    for (let x = 0; x < T; x++) {
      const y = 2 + Math.round(Math.sin(x * 0.5) * 0.8);
      for (let yy = 0; yy < y; yy++) p.clearPx(x, yy);
      p.set(x, y, light, water ? 230 : 255);
      p.set(x, y + 1, mix(light, mid, 0.5), water ? 200 : 255);
    }
  }
}

/** cut the open sides: ragged lip, rounded corners, lit top, shadowed underside */
function edges(p: Pix, m: M, mask: number, s: number): void {
  const top = mask & 1;
  const right = mask & 2;
  const bottom = mask & 4;
  const left = mask & 8;
  const hard = MATERIALS[m].hardness >= 4 || m === M.ALLOY || m === M.BRICK;
  const jit = (k: number, axis: number) => (hard ? (n01(k >> 1, axis, s) > 0.6 ? 1 : 0) : Math.floor(n01(k >> 1, axis, s) * 2.6));
  const R = hard ? 3 : 6;
  const cols = MATERIALS[m].colors;
  const light = m === M.GRASS ? 0x8fd14f : mix(cols[0], 0xffffff, 0.2);
  const dark = mix(cols[2], 0x000000, 0.35);
  const depth = new Float32Array(T * T).fill(99);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      let d = 99;
      let side = -1;
      const consider = (dist: number, sd: number) => {
        if (dist < d) {
          d = dist;
          side = sd;
        }
      };
      if (top) consider(y - jit(x, 1), 0);
      if (bottom) consider(T - 1 - y - jit(x, 2), 2);
      if (left) consider(x - jit(y, 3), 3);
      if (right) consider(T - 1 - x - jit(y, 4), 1);
      // rounded corners where two open sides meet
      const corner = (cx: number, cy: number) => {
        const dx = Math.max(0, Math.abs(x + 0.5 - cx) - 0);
        const dy = Math.max(0, Math.abs(y + 0.5 - cy) - 0);
        return R - Math.hypot(dx, dy);
      };
      if (top && left && x < R && y < R) consider(-corner(R, R), y < x ? 0 : 3);
      if (top && right && x >= T - R && y < R) consider(-corner(T - R, R), 0);
      if (bottom && left && x < R && y >= T - R) consider(-corner(R, T - R), 2);
      if (bottom && right && x >= T - R && y >= T - R) consider(-corner(T - R, T - R), 2);
      depth[y * T + x] = d;
      if (d < 0) {
        p.clearPx(x, y);
        continue;
      }
      if (side < 0 || d >= 3) continue;
      const c = p.get(x, y);
      if (side === 0) p.set(x, y, d < 1 ? light : d < 2 ? mix(c, light, 0.45) : mix(c, light, 0.15));
      else if (side === 2) p.set(x, y, d < 1 ? dark : mix(c, dark, 0.45));
      else p.set(x, y, d < 1 ? mix(c, dark, 0.7) : mix(c, dark, 0.3));
    }
  }
  // grass grows on an open top
  if (m === M.GRASS && top) {
    for (let x = 0; x < T; x++) {
      const h = 5 + Math.floor(n01(x, 1, s) * 3);
      for (let y = 0; y < T; y++) {
        if (depth[y * T + x] < 0) continue;
        const d = depth[y * T + x];
        if (d < h) p.set(x, y, d < 1.5 ? 0xa8e05f : d < h - 2 ? 0x6cbf3f : 0x4e9a33);
      }
      // blades
      if (n01(x, 5, s) > 0.62) {
        const bh = 2 + Math.floor(n01(x, 6, s) * 3);
        const y0 = Math.max(0, jit(x, 1));
        for (let k = 1; k <= bh && y0 - k >= -3; k++) if (y0 - k >= 0) p.set(x, y0 - k, k === bh ? 0xc4f07a : 0x7ccf47);
      }
    }
  }
}

/** the terrain sheet: MATERIAL_COUNT rows of 32 frames */
export function paintTerrain(): Sheet {
  const sheet = new Sheet(T, T, FRAMES_PER_MAT, MATERIAL_COUNT);
  for (let m = 1; m < MATERIAL_COUNT; m++) {
    for (let mask = 0; mask < 16; mask++) {
      for (let v = 0; v < VARIANTS; v++) {
        const s = m * 977 + v * 131;
        const p = new Pix(T, T);
        if (MATERIALS[m].liquid) paintLiquid(p, m as M, mask, s);
        else {
          (BASE[m as M] ?? ((pp: Pix, _v: number, ss: number) => speckle(pp, MATERIALS[m].colors, ss)))(p, v, s);
          edges(p, m as M, mask, s + mask * 17);
        }
        sheet.put(terrainFrame(m, mask, v), p);
      }
    }
  }
  return sheet;
}

/** cave walls behind dug cells: one row per biome, 16 masks of shadow from solid neighbours */
export function paintBackdrop(): Sheet {
  const sheet = new Sheet(T, T, 16 * VARIANTS, BIOMES.length);
  const wallBase: M[] = [M.DIRT, M.CRYSTAL_ROCK, M.SLATE, M.PERMAFROST, M.BASALT, M.VOIDSTONE];
  BIOMES.forEach((b, bi) => {
    for (let mask = 0; mask < 16; mask++) {
      for (let v = 0; v < VARIANTS; v++) {
        const p = new Pix(T, T);
        const s = 5000 + bi * 97 + v * 13;
        (BASE[wallBase[bi]] ?? (() => {}))(p, v, s);
        // dim and pull toward the biome's ambient colour
        for (let y = 0; y < T; y++)
          for (let x = 0; x < T; x++) {
            const c = p.get(x, y);
            p.set(x, y, mix(mix(c, b.ambient, 0.55), 0x000000, 0.35));
          }
        // shadow cast by solid neighbours (mask bit = that side is solid)
        for (let y = 0; y < T; y++)
          for (let x = 0; x < T; x++) {
            let k = 0;
            if (mask & 1) k = Math.max(k, 1 - y / 9);
            if (mask & 2) k = Math.max(k, 1 - (T - 1 - x) / 7);
            if (mask & 4) k = Math.max(k, 1 - (T - 1 - y) / 5);
            if (mask & 8) k = Math.max(k, 1 - x / 7);
            if (k > 0) p.set(x, y, mix(p.get(x, y), 0x000000, k * 0.6));
          }
        sheet.put(bi * 16 * VARIANTS + mask * VARIANTS + v, p);
      }
    }
  });
  return sheet;
}
