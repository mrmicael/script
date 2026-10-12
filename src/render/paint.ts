// A tiny pixel painter: every sprite in the game is drawn here, pixel by
// pixel, with no anti-aliasing, so the art keeps a strict pixel grid.

import { hash01 } from '../core/rng';

export type RGB = number;

export const rgb = (r: number, g: number, b: number): RGB => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
export const R = (c: RGB) => (c >> 16) & 255;
export const G = (c: RGB) => (c >> 8) & 255;
export const B = (c: RGB) => c & 255;

export function mix(a: RGB, b: RGB, t: number): RGB {
  t = Math.max(0, Math.min(1, t));
  return rgb(Math.round(R(a) + (R(b) - R(a)) * t), Math.round(G(a) + (G(b) - G(a)) * t), Math.round(B(a) + (B(b) - B(a)) * t));
}
export const shade = (c: RGB, k: number): RGB => (k >= 0 ? mix(c, 0xffffff, k) : mix(c, 0x000000, -k));

export class Pix {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  set(x: number, y: number, c: RGB, a = 255): void {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255) {
      this.data[i] = R(c);
      this.data[i + 1] = G(c);
      this.data[i + 2] = B(c);
      this.data[i + 3] = 255;
      return;
    }
    // blend over what is there
    const sa = a / 255;
    const da = this.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    this.data[i] = (R(c) * sa + this.data[i] * da * (1 - sa)) / oa;
    this.data[i + 1] = (G(c) * sa + this.data[i + 1] * da * (1 - sa)) / oa;
    this.data[i + 2] = (B(c) * sa + this.data[i + 2] * da * (1 - sa)) / oa;
    this.data[i + 3] = oa * 255;
  }
  alpha(x: number, y: number): number {
    if (!this.inside(x, y)) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }
  get(x: number, y: number): RGB {
    const i = (y * this.w + x) * 4;
    return rgb(this.data[i], this.data[i + 1], this.data[i + 2]);
  }
  clearPx(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    this.data[(y * this.w + x) * 4 + 3] = 0;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 255): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c, a);
  }
  /** filled ellipse centred on a pixel centre */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 255): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c, a);
      }
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB, a = 255): void {
    this.ellipse(cx, cy, r, r, c, a);
  }
  poly(pts: number[], c: RGB, a = 255): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < pts.length; i += 2) {
      minY = Math.min(minY, pts[i]);
      maxY = Math.max(maxY, pts[i]);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const py = y + 0.5;
      const xs: number[] = [];
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const yi = pts[i + 1];
        const yj = pts[j + 1];
        if (yi > py !== yj > py) xs.push(pts[i] + ((py - yi) * (pts[j] - pts[i])) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, c, a);
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 255): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  /** thick line as a chain of discs */
  thick(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB, a = 255): void {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, c, a);
    }
  }
  /** 1px outline around every opaque pixel (on transparent neighbours) */
  outline(c: RGB, diagonal = false): void {
    const src = new Uint8ClampedArray(this.data);
    const op = (x: number, y: number) => x >= 0 && y >= 0 && x < this.w && y < this.h && src[(y * this.w + x) * 4 + 3] > 40;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (op(x, y)) continue;
        const n = op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1) || (diagonal && (op(x - 1, y - 1) || op(x + 1, y - 1) || op(x - 1, y + 1) || op(x + 1, y + 1)));
        if (n) this.set(x, y, c);
      }
    }
  }
  /** darken pixels whose neighbour toward the light is empty: cheap rim shading */
  rimLight(light: RGB, dark: RGB, k = 0.35): void {
    const src = new Uint8ClampedArray(this.data);
    const op = (x: number, y: number) => x >= 0 && y >= 0 && x < this.w && y < this.h && src[(y * this.w + x) * 4 + 3] > 40;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!op(x, y)) continue;
        const i = (y * this.w + x) * 4;
        const c = rgb(src[i], src[i + 1], src[i + 2]);
        if (!op(x, y - 1) || !op(x - 1, y)) this.set(x, y, mix(c, light, k));
        else if (!op(x, y + 1) || !op(x + 1, y)) this.set(x, y, mix(c, dark, k));
      }
    }
  }
  blit(src: Pix, dx: number, dy: number, flipX = false): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const a = src.data[(y * src.w + x) * 4 + 3];
        if (!a) continue;
        const sx = flipX ? src.w - 1 - x : x;
        void sx;
        const i = (y * src.w + (flipX ? src.w - 1 - x : x)) * 4;
        this.set(dx + x, dy + y, rgb(src.data[i], src.data[i + 1], src.data[i + 2]), a);
      }
    }
  }
  /** rotate 90° clockwise k times */
  rot90(k: number): Pix {
    k = ((k % 4) + 4) % 4;
    if (!k) return this;
    const out = new Pix(k % 2 ? this.h : this.w, k % 2 ? this.w : this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        let nx = x;
        let ny = y;
        if (k === 1) {
          nx = this.h - 1 - y;
          ny = x;
        } else if (k === 2) {
          nx = this.w - 1 - x;
          ny = this.h - 1 - y;
        } else {
          nx = y;
          ny = this.w - 1 - x;
        }
        const o = (ny * out.w + nx) * 4;
        out.data[o] = this.data[i];
        out.data[o + 1] = this.data[i + 1];
        out.data[o + 2] = this.data[i + 2];
        out.data[o + 3] = this.data[i + 3];
      }
    }
    return out;
  }
  flipX(): Pix {
    const out = new Pix(this.w, this.h);
    out.blit(this, 0, 0, true);
    return out;
  }
  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    c.getContext('2d')!.putImageData(new ImageData(this.data as unknown as Uint8ClampedArray<ArrayBuffer>, this.w, this.h), 0, 0);
    return c;
  }
}

/** a sheet of equal frames, painted one at a time */
export class Sheet {
  readonly pix: Pix;
  constructor(
    readonly fw: number,
    readonly fh: number,
    readonly cols: number,
    readonly rows: number,
  ) {
    this.pix = new Pix(fw * cols, fh * rows);
  }
  put(index: number, frame: Pix): void {
    const x = (index % this.cols) * this.fw;
    const y = Math.floor(index / this.cols) * this.fh;
    for (let yy = 0; yy < frame.h; yy++) {
      const src = yy * frame.w * 4;
      const dst = ((y + yy) * this.pix.w + x) * 4;
      this.pix.data.set(frame.data.subarray(src, src + frame.w * 4), dst);
    }
  }
}

/** deterministic noise helper for painters */
export const n01 = (x: number, y: number, s: number): number => hash01(x, y, s);
