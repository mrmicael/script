// Ore overlays drawn on top of the host rock, and small icons for the HUD.
// Every ore differs in silhouette, not just colour: nuggets, prisms, cut
// gems, a cog, a star, a pearl.

import { O, ORES, ORE_COUNT } from '../../core/materials';
import { Pix, Sheet, mix, n01, shade, type RGB } from '../paint';

export const ORE_VARIANTS = 3;
const T = 32;

function nugget(p: Pix, cx: number, cy: number, r: number, base: RGB): void {
  p.ellipse(cx, cy, r * 1.15, r, shade(base, -0.45));
  p.ellipse(cx - 0.3, cy - 0.3, r * 1.15 - 0.8, r - 0.8, base);
  p.ellipse(cx - r * 0.35, cy - r * 0.35, r * 0.45, r * 0.35, shade(base, 0.45));
  p.set(Math.round(cx - r * 0.45), Math.round(cy - r * 0.5), 0xffffff);
}

/** an upright hexagonal prism with a pointed cap, like a quartz point */
function prism(p: Pix, x: number, base: number, h: number, w: number, col: RGB, lean = 0): void {
  const top = base - h;
  const pts = [x - w, base, x - w + lean, top + w, x + lean, top, x + w + lean, top + w, x + w, base];
  p.poly(pts, shade(col, -0.5));
  p.poly([x - w + 1, base, x - w + 1 + lean, top + w + 0.5, x + lean, top + 1.2, x + lean, base], shade(col, 0.15));
  p.poly([x + lean, base, x + lean, top + 1.2, x + w - 1 + lean, top + w + 0.5, x + w - 1, base], shade(col, -0.15));
  p.line(x - w + 2 + lean * 0.8, base - 2, x - w + 2 + lean * 0.9, top + w + 1, shade(col, 0.6));
}

/** a cut gem seen from the front: octagon with a table and facets */
function cutGem(p: Pix, cx: number, cy: number, r: number, col: RGB): void {
  const k = r * 0.42;
  const pts = [cx - k, cy - r, cx + k, cy - r, cx + r, cy - k, cx + r, cy + k, cx + k, cy + r, cx - k, cy + r, cx - r, cy + k, cx - r, cy - k];
  p.poly(pts, shade(col, -0.55));
  const i = r - 1.2;
  const ki = i * 0.42;
  p.poly([cx - ki, cy - i, cx + ki, cy - i, cx + i, cy - ki, cx + i, cy + ki, cx + ki, cy + i, cx - ki, cy + i, cx - i, cy + ki, cx - i, cy - ki], col);
  // lower facets darker, table lighter
  p.poly([cx - i, cy + ki * 0.2, cx + i, cy + ki * 0.2, cx + ki, cy + i, cx - ki, cy + i], shade(col, -0.22));
  p.rect(Math.round(cx - ki), Math.round(cy - ki), Math.round(ki * 2), Math.round(ki * 1.2), shade(col, 0.25));
  p.line(cx - ki, cy - i + 1, cx - i + 1, cy - ki, shade(col, 0.7));
  p.set(Math.round(cx - ki + 1), Math.round(cy - ki + 1), 0xffffff);
}

function cog(p: Pix, cx: number, cy: number, r: number, col: RGB): void {
  for (let a = 0; a < 8; a++) {
    const t = (a / 8) * Math.PI * 2;
    p.circle(cx + Math.cos(t) * r * 0.95, cy + Math.sin(t) * r * 0.95, r * 0.26, shade(col, -0.35));
  }
  p.circle(cx, cy, r * 0.82, shade(col, -0.35));
  p.circle(cx, cy, r * 0.7, col);
  p.circle(cx - 0.6, cy - 0.6, r * 0.45, shade(col, 0.35));
  p.circle(cx, cy, r * 0.25, 0x1b2a2a);
}

function star(p: Pix, cx: number, cy: number, r: number, col: RGB): void {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.5 : r;
    pts.push(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr);
  }
  p.poly(pts, shade(col, -0.45));
  const inner = pts.map((v, i) => (i % 2 ? cy + (v - cy) * 0.72 : cx + (v - cx) * 0.72));
  p.poly(inner, col);
  p.circle(cx - 1, cy - 1, r * 0.25, shade(col, 0.6));
}

function pearl(p: Pix, cx: number, cy: number, r: number, col: RGB): void {
  p.circle(cx, cy, r, shade(col, -0.5));
  p.circle(cx, cy, r - 1, col);
  p.circle(cx + 1, cy + 1, r - 2.5, shade(col, -0.15));
  p.circle(cx - r * 0.35, cy - r * 0.35, r * 0.35, 0xffffff);
}

function shard(p: Pix, cx: number, cy: number, r: number, col: RGB, seed: number): void {
  const pts: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * Math.PI * 2 + n01(i, 1, seed);
    const rr = r * (0.6 + n01(i, 2, seed) * 0.5);
    pts.push(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr);
  }
  p.poly(pts, shade(col, -0.4));
  p.poly(pts.map((v, i) => (i % 2 ? cy + (v - cy) * 0.7 - 0.6 : cx + (v - cx) * 0.7 - 0.6)), col);
  p.line(cx - r * 0.3, cy - r * 0.2, cx + r * 0.1, cy - r * 0.5, 0xd8c8ff);
}

/** spots for clusters, inside the tile with a margin */
const SPOTS: [number, number][][] = [
  [
    [10, 11],
    [21, 9],
    [16, 21],
    [24, 22],
  ],
  [
    [9, 20],
    [17, 10],
    [24, 18],
    [12, 25],
  ],
  [
    [12, 12],
    [22, 14],
    [9, 23],
    [20, 24],
  ],
];

export function paintOre(p: Pix, ore: O, v: number): void {
  const def = ORES[ore];
  const col = def.color;
  const spots = SPOTS[v % SPOTS.length];
  const s = ore * 31 + v * 7;
  switch (ore) {
    case O.COPPER:
    case O.IRON:
    case O.SILVER:
    case O.GOLD:
    case O.PLATINUM:
      spots.forEach(([x, y], i) => nugget(p, x, y, (ore === O.GOLD ? 3.4 : 3) - (i % 2) * 0.6, i === 2 ? mix(col, 0xffffff, 0.1) : col));
      break;
    case O.TOPAZ:
    case O.AMETHYST:
    case O.FROST_OPAL:
    case O.COOLANT:
      prism(p, 13 + v, 26, 15, 3.4, col, -1);
      prism(p, 20 + v, 27, 11, 3, col, 2);
      prism(p, 9 + v, 28, 8, 2.6, col, -2);
      if (ore === O.COOLANT) {
        p.set(14 + v, 12, 0xffffff);
        p.set(13 + v, 13, 0xffffff);
        p.set(15 + v, 13, 0xffffff);
      }
      break;
    case O.SAPPHIRE:
    case O.EMERALD:
    case O.RUBY:
    case O.SUNSTONE:
      cutGem(p, 16 + (v - 1) * 2, 16 + (v === 2 ? 2 : -1), ore === O.SUNSTONE ? 8 : 7, col);
      nugget(p, 7 + v * 2, 26, 1.6, shade(col, -0.2));
      break;
    case O.RELIC:
      cog(p, 15 + v, 16, 8, 0x7fb8a8);
      p.circle(15 + v, 16, 1.5, 0x7ff0e0);
      break;
    case O.OBSIDIAN:
      spots.slice(0, 3).forEach(([x, y], i) => shard(p, x, y, 4.5 - i * 0.5, col, s + i));
      break;
    case O.STARMETAL:
      star(p, 16, 15 + v, 8, col);
      break;
    case O.VOID_PEARL:
      pearl(p, 16 + v, 16, 6.5, col);
      p.circle(8, 25, 2, shade(col, -0.2));
      break;
    case O.BONE:
      break;
  }
}

export function paintOres(): Sheet {
  const sheet = new Sheet(T, T, ORE_VARIANTS, ORE_COUNT);
  for (let o = 1; o < ORE_COUNT; o++) {
    for (let v = 0; v < ORE_VARIANTS; v++) {
      const p = new Pix(T, T);
      paintOre(p, o as O, v);
      sheet.put(o * ORE_VARIANTS + v, p);
    }
  }
  return sheet;
}

/** 16px icons for the HUD and the haul report */
export function paintOreIcon(ore: O): Pix {
  const big = new Pix(T, T);
  if (ore === O.BONE) {
    big.thick(9, 20, 23, 12, 2.2, 0xf4ead2);
    for (const [x, y] of [
      [8, 18],
      [10, 22],
      [22, 10],
      [24, 14],
    ])
      big.circle(x, y, 3, 0xf4ead2);
    big.outline(0x6e5a3a);
  } else {
    paintOre(big, ore, 1);
  }
  return big;
}
