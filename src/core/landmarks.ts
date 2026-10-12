// Landmarks are described once, as shapes in tile units. The generator
// rasterises them into the grid; the renderer paints the same shapes at full
// resolution, so what the player sees and what the drill hits always agree.

import { M, O } from './materials';

export type Prim =
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { k: 'capsule'; ax: number; ay: number; bx: number; by: number; r: number }
  | { k: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { k: 'poly'; pts: number[] };

/** liquids only fill cells the stamp has already carved */
export type Fill = 'carve' | 'water' | 'lava' | M;

export interface StampOp {
  prim: Prim;
  fill: Fill;
  /** ore chances for the solid cells this op writes */
  ore?: [O, number][];
  /** the renderer paints this op's shape over the solid tiles */
  decor?: boolean;
}

export interface StampPickup {
  kind: 'chest' | 'artifact' | 'flask';
  x: number;
  y: number;
  artifact?: number;
  value?: number;
}

export interface LandmarkDef {
  key: string;
  biome: number;
  w: number;
  h: number;
  /** depth range (tiles) for the top edge */
  depth: [number, number];
  ops: StampOp[];
  pickups: StampPickup[];
}

const E = (cx: number, cy: number, rx: number, ry: number): Prim => ({ k: 'ellipse', cx, cy, rx, ry });
const C = (ax: number, ay: number, bx: number, by: number, r: number): Prim => ({ k: 'capsule', ax, ay, bx, by, r });
const R = (x0: number, y0: number, x1: number, y1: number): Prim => ({ k: 'rect', x0, y0, x1, y1 });
const P = (...pts: number[]): Prim => ({ k: 'poly', pts });

const bone = (prim: Prim): StampOp => ({ prim, fill: M.FOSSIL, ore: [[O.BONE, 1]], decor: true });

// --- the giant fossil (Soft Earth) -----------------------------------------
const spine: [number, number][] = [
  [17.2, 4.1],
  [15, 4.5],
  [12.5, 4.7],
  [10, 4.8],
  [7.5, 5],
  [5, 5.6],
  [3, 6.6],
  [1.4, 8],
];
const fossilOps: StampOp[] = [];
for (let i = 0; i < spine.length - 1; i++) fossilOps.push(bone(C(spine[i][0], spine[i][1], spine[i + 1][0], spine[i + 1][1], 0.42 - i * 0.025)));
for (let i = 0; i < 5; i++) {
  const x = 13.6 - i * 1.25;
  fossilOps.push(bone(C(x, 4.9, x - 0.7, 6.4, 0.24)), bone(C(x - 0.7, 6.4, x - 0.2, 7.6, 0.22)));
}
fossilOps.push(
  bone(E(19.4, 3.3, 1.9, 1.15)),
  bone(C(18, 4.5, 20.9, 4.3, 0.32)),
  bone(E(7.2, 5.5, 1.3, 0.75)),
  bone(C(12.6, 5.2, 13.1, 7.3, 0.36)),
  bone(C(13.1, 7.3, 12.3, 9.1, 0.32)),
  bone(C(6.8, 5.8, 7.6, 7.6, 0.38)),
  bone(C(7.6, 7.6, 6.6, 9.2, 0.34)),
);

// --- the crystal cathedral (Crystal Veins) ---------------------------------
const gem: [O, number][] = [
  [O.AMETHYST, 0.45],
  [O.SAPPHIRE, 0.12],
];
const spire = (cx: number, base: number, tip: number, half: number): StampOp => ({
  prim: P(cx - half, base, cx - half * 0.35, tip + (base > tip ? 1 : -1) * 0.8, cx, tip, cx + half * 0.35, tip + (base > tip ? 1 : -1) * 0.8, cx + half, base),
  fill: M.CRYSTAL_ROCK,
  ore: gem,
  decor: true,
});

// --- the buried train (Ancient Ruins) --------------------------------------
const car = (x0: number, x1: number): StampOp[] => [
  { prim: R(x0, 0.6, x1, 6.6), fill: M.ALLOY, decor: true },
  { prim: R(x0 + 1, 1.6, x1 - 1, 5.6), fill: 'carve' },
];

export const LANDMARKS: LandmarkDef[] = [
  {
    key: 'fossil',
    biome: 0,
    w: 22,
    h: 10,
    depth: [17, 26],
    ops: fossilOps,
    pickups: [{ kind: 'artifact', x: 19, y: 3, artifact: 0 }],
  },
  {
    key: 'cathedral',
    biome: 1,
    w: 28,
    h: 16,
    depth: [56, 74],
    ops: [
      { prim: E(14, 8, 13.2, 7.4), fill: 'carve' },
      spire(4.5, 15.5, 8.5, 1.8),
      spire(8.5, 15.5, 5.5, 2.2),
      spire(19.5, 15.5, 6.5, 2.2),
      spire(23.8, 15.5, 9.5, 1.6),
      spire(10.5, 0.5, 4.6, 1.4),
      spire(17.5, 0.5, 5.2, 1.6),
      spire(14, 0.5, 3.2, 1),
      { prim: R(12.5, 13.6, 15.5, 16), fill: M.CRYSTAL_ROCK, decor: true },
    ],
    pickups: [
      { kind: 'artifact', x: 14, y: 12, artifact: 2 },
      { kind: 'chest', x: 3, y: 13 },
    ],
  },
  {
    key: 'train',
    biome: 2,
    w: 36,
    h: 8,
    depth: [112, 140],
    ops: [
      ...car(0.5, 12.5),
      { prim: C(12.5, 4.2, 13.5, 4.2, 0.5), fill: M.ALLOY, decor: true },
      ...car(13.5, 24.5),
      { prim: C(24.5, 4.2, 25.5, 4.2, 0.5), fill: M.ALLOY, decor: true },
      ...car(25.5, 35.5),
    ],
    pickups: [
      { kind: 'artifact', x: 4, y: 4, artifact: 4 },
      { kind: 'chest', x: 18, y: 4 },
      { kind: 'chest', x: 31, y: 4 },
      { kind: 'flask', x: 21, y: 4 },
    ],
  },
  {
    key: 'lake',
    biome: 3,
    w: 26,
    h: 13,
    depth: [182, 205],
    ops: [
      { prim: E(13, 6.5, 12.6, 6.2), fill: 'carve' },
      { prim: R(0, 7, 26, 13), fill: 'water' },
      { prim: E(4.6, 4.2, 3.4, 2.7), fill: M.ICE, decor: true },
      { prim: R(9, 6.2, 22, 7), fill: M.ICE, decor: true },
    ],
    pickups: [
      { kind: 'artifact', x: 13, y: 11, artifact: 6 },
      { kind: 'flask', x: 22, y: 5 },
    ],
  },
  {
    key: 'forge',
    biome: 4,
    w: 22,
    h: 12,
    depth: [252, 284],
    ops: [
      { prim: R(1, 2, 21, 11), fill: 'carve' },
      { prim: E(11, 2.6, 10, 2.4), fill: 'carve' },
      { prim: R(1.5, 9.4, 20.5, 11), fill: 'lava' },
      { prim: R(9.5, 6.3, 13.5, 11), fill: M.BASALT, decor: true },
      { prim: P(1.2, 11, 1.2, 3.4, 2.6, 2, 5.4, 2, 6.8, 3.4, 6.8, 9.4, 6.4, 11), fill: M.BASALT, decor: true },
      { prim: R(15.5, 7.3, 19.5, 9.4), fill: M.ALLOY, decor: true },
    ],
    pickups: [
      { kind: 'artifact', x: 11, y: 5, artifact: 8 },
      { kind: 'chest', x: 17, y: 6 },
    ],
  },
  {
    key: 'stars',
    biome: 5,
    w: 24,
    h: 16,
    depth: [318, 340],
    ops: [
      { prim: E(12, 8, 11.6, 7.6), fill: 'carve' },
      { prim: E(5.6, 8.6, 2.2, 0.9), fill: M.VOIDSTONE, ore: [[O.VOID_PEARL, 0.25]], decor: true },
      { prim: E(12, 10.2, 2.8, 1.1), fill: M.VOIDSTONE, decor: true },
      { prim: E(18.4, 7.4, 2.1, 0.9), fill: M.VOIDSTONE, ore: [[O.STARMETAL, 0.4]], decor: true },
      { prim: R(1, 14.2, 23, 16), fill: 'lava' },
    ],
    pickups: [{ kind: 'artifact', x: 12, y: 8, artifact: 10 }],
  },
];

/** the sealed door at the bottom; placed separately, never moves */
export const DOOR_STAMP: LandmarkDef = {
  key: 'door',
  biome: 5,
  w: 26,
  h: 13,
  depth: [366, 366],
  ops: [
    { prim: R(0, 0, 26, 13), fill: M.BEDROCK },
    { prim: R(1, 2, 15, 11), fill: 'carve' },
    { prim: E(8, 2.4, 7, 1.8), fill: 'carve' },
    { prim: R(15, 4, 18, 11), fill: M.DOOR, decor: true },
    { prim: R(18, 4, 25, 11), fill: 'carve' },
  ],
  pickups: [{ kind: 'artifact', x: 22, y: 10, artifact: 12 }],
};

/** waystation chamber: the pod stands on the 2-cell pad at (2..3, 3) */
export const WAYSTATION_STAMP = { w: 6, h: 4 } as const;

export const LANDMARK_KEYS = [...LANDMARKS.map((l) => l.key), 'door', 'waystation'];

/** decor value: (landmark type + 1) << 10 | local cell */
export const decorValue = (type: number, lx: number, ly: number): number => ((type + 1) << 10) | (ly * 64 + lx);
export const decorType = (v: number): number => (v >> 10) - 1;
export const decorLocal = (v: number): [number, number] => [(v & 1023) % 64, Math.floor((v & 1023) / 64)];

function pointInPoly(px: number, py: number, pts: number[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** is the point inside the primitive (tile units, local to the stamp) */
export function primContains(p: Prim, x: number, y: number): boolean {
  switch (p.k) {
    case 'ellipse': {
      const dx = (x - p.cx) / p.rx;
      const dy = (y - p.cy) / p.ry;
      return dx * dx + dy * dy <= 1;
    }
    case 'capsule': {
      const vx = p.bx - p.ax;
      const vy = p.by - p.ay;
      const l2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - p.ax) * vx + (y - p.ay) * vy) / l2));
      const dx = x - (p.ax + vx * t);
      const dy = y - (p.ay + vy * t);
      return dx * dx + dy * dy <= p.r * p.r;
    }
    case 'rect':
      return x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1;
    case 'poly':
      return pointInPoly(x, y, p.pts);
  }
}

/** a cell belongs to a shape when enough of it is covered (thin bones still count) */
export function cellCovered(p: Prim, lx: number, ly: number): boolean {
  if (primContains(p, lx + 0.5, ly + 0.5)) return true;
  if (p.k !== 'capsule') return false;
  // thin shapes: any of four inner sample points
  return primContains(p, lx + 0.25, ly + 0.25) || primContains(p, lx + 0.75, ly + 0.25) || primContains(p, lx + 0.25, ly + 0.75) || primContains(p, lx + 0.75, ly + 0.75);
}
