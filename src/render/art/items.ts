// Pickups (crates, coolant flasks) and the artifact collection icons.

import { Pix, shade, type RGB } from '../paint';

const INK = 0x1a1420;

export function paintChest(): Pix {
  const p = new Pix(24, 20);
  p.rect(1, 6, 22, 13, 0x7a4a26);
  p.rect(2, 7, 20, 11, 0xa8713f);
  p.rect(2, 7, 20, 1, 0xd29a5e);
  // lid
  p.rect(1, 2, 22, 6, 0x8a5530);
  p.rect(2, 3, 20, 4, 0xc0844a);
  p.rect(2, 3, 20, 1, 0xe8b070);
  // gold bands and lock
  for (const x of [5, 18]) p.rect(x, 2, 2, 17, 0xf2c14e);
  p.rect(10, 6, 4, 5, 0xf2c14e);
  p.rect(11, 8, 2, 2, 0x5a3a14);
  p.set(5, 3, 0xfff2b0);
  p.set(18, 3, 0xfff2b0);
  p.outline(INK);
  return p;
}

export function paintFlask(): Pix {
  const p = new Pix(16, 22);
  p.rect(5, 1, 6, 4, 0x8a8f9a);
  p.rect(5, 1, 6, 1, 0xd6dde4);
  p.rect(3, 5, 10, 15, 0x2b6f8a);
  p.rect(4, 7, 8, 12, 0x7fe9ff);
  p.rect(4, 7, 8, 3, 0xc8f8ff);
  p.rect(5, 12, 2, 5, 0xe8feff);
  // snowflake mark
  p.line(8, 12, 10, 16, 0x2b6f8a);
  p.line(10, 12, 8, 16, 0x2b6f8a);
  p.line(7, 14, 11, 14, 0x2b6f8a);
  p.outline(INK);
  return p;
}

/** a key with an emblem in its bow */
function key(bow: (p: Pix) => void, metal: RGB): Pix {
  const p = new Pix(28, 28);
  // shaft and bit
  p.rect(13, 13, 3, 13, shade(metal, -0.35));
  p.rect(13, 13, 2, 13, metal);
  p.rect(15, 20, 5, 2, metal);
  p.rect(15, 24, 4, 2, metal);
  // bow ring
  p.circle(14, 8, 7.5, shade(metal, -0.4));
  p.circle(14, 8, 6.4, metal);
  p.circle(13, 7, 5, shade(metal, 0.2));
  bow(p);
  p.outline(INK);
  return p;
}

const gemBow = (col: RGB) => (p: Pix) => {
  p.circle(14, 8, 4.2, shade(col, -0.45));
  p.circle(14, 8, 3.3, col);
  p.circle(13, 7, 1.5, shade(col, 0.6));
};

export function paintArtifact(i: number): Pix {
  switch (i) {
    case 0:
      return key(gemBow(0xffa31a), 0xe0b050);
    case 1: {
      const p = new Pix(28, 28);
      p.circle(14, 15, 10, 0x8a6a2a);
      p.circle(14, 15, 9, 0xf2c14e);
      p.circle(14, 15, 7, 0xfff4d6);
      p.line(14, 15, 14, 10, INK);
      p.line(14, 15, 17, 16, INK);
      p.rect(12, 2, 4, 3, 0xf2c14e);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        p.set(14 + Math.cos(a) * 6, 15 + Math.sin(a) * 6, 0x8a6a2a);
      }
      p.outline(INK);
      return p;
    }
    case 2:
      return key((p) => {
        p.poly([14, 2, 19, 8, 14, 14, 9, 8], 0x6a5fd0);
        p.poly([14, 3, 14, 13, 10, 8], 0xb8b0ff);
        p.set(13, 6, 0xffffff);
      }, 0xc8ccd8);
    case 3: {
      const p = new Pix(28, 28);
      p.poly([10, 26, 9, 10, 12, 3, 15, 10, 14, 26], 0x9a6bff);
      p.poly([14, 26, 15, 12, 18, 5, 21, 12, 19, 26], 0xc86bff);
      p.line(11, 6, 10, 22, 0xe8d8ff);
      p.line(17, 8, 16, 22, 0xf0e0ff);
      for (const [x, y] of [
        [4, 8],
        [24, 10],
        [3, 14],
        [25, 16],
      ])
        p.set(x, y, 0xe8d8ff);
      p.outline(INK);
      return p;
    }
    case 4:
      return key((p) => {
        for (let a = 0; a < 8; a++) {
          const t = (a / 8) * Math.PI * 2;
          p.circle(14 + Math.cos(t) * 4.5, 8 + Math.sin(t) * 4.5, 1.4, 0x5f8f8c);
        }
        p.circle(14, 8, 4, 0x7fb8a8);
        p.circle(14, 8, 1.5, 0x1b2a2a);
      }, 0x9fd6cf);
    case 5: {
      const p = new Pix(28, 28);
      p.poly([14, 2, 24, 6, 22, 18, 14, 25, 6, 18, 4, 6], 0x34514f);
      p.poly([14, 4, 22, 7, 20, 17, 14, 23, 8, 17, 6, 7], 0x5f8f8c);
      p.circle(14, 13, 5, 0xf2c14e);
      p.circle(14, 13, 2, 0x34514f);
      p.outline(INK);
      return p;
    }
    case 6:
      return key((p) => {
        p.line(14, 3, 14, 13, 0xffffff);
        p.line(9, 8, 19, 8, 0xffffff);
        p.line(10, 4, 18, 12, 0xd8f6ff);
        p.line(18, 4, 10, 12, 0xd8f6ff);
      }, 0x9fd4ef);
    case 7: {
      const p = new Pix(28, 28);
      p.rect(9, 7, 10, 16, 0x4a5d70);
      p.rect(10, 9, 8, 12, 0x9ff7ff);
      p.ellipse(14, 15, 2.5, 4, 0x4fa8ff);
      p.ellipse(14, 16, 1.2, 2, 0xffffff);
      p.rect(8, 5, 12, 3, 0x2b3a48);
      p.rect(11, 2, 6, 3, 0x2b3a48);
      p.rect(8, 23, 12, 2, 0x2b3a48);
      p.outline(INK);
      return p;
    }
    case 8:
      return key((p) => {
        p.ellipse(14, 9, 3.5, 4.5, 0xff5a2a);
        p.ellipse(14, 10, 2.2, 3, 0xffb347);
        p.ellipse(14, 11, 1, 1.6, 0xfff2b0);
      }, 0x8a5a4a);
    case 9: {
      const p = new Pix(28, 28);
      p.poly([3, 22, 3, 9, 8, 15, 14, 5, 20, 15, 25, 9, 25, 22], 0xc9862a);
      p.poly([4, 21, 4, 12, 8, 17, 14, 8, 20, 17, 24, 12, 24, 21], 0xffb347);
      p.rect(3, 19, 22, 4, 0xe0522a);
      for (const x of [8, 14, 20]) p.circle(x, 21, 1.5, 0xff3355);
      p.outline(INK);
      return p;
    }
    case 10:
      return key(gemBow(0xc89bff), 0x6b5fa8);
    case 11: {
      const p = new Pix(28, 28);
      p.rect(3, 6, 22, 16, 0x3a2e5a);
      p.rect(4, 7, 20, 14, 0x1c1638);
      p.ellipse(3, 14, 2.5, 8, 0xd6c7a2);
      p.ellipse(25, 14, 2.5, 8, 0xd6c7a2);
      for (const [x, y] of [
        [8, 10],
        [12, 16],
        [17, 11],
        [20, 17],
        [15, 13],
      ])
        p.set(x, y, 0xfff6c8);
      p.line(8, 10, 12, 16, 0x6b5fa8);
      p.line(12, 16, 17, 11, 0x6b5fa8);
      p.line(17, 11, 20, 17, 0x6b5fa8);
      p.outline(INK);
      return p;
    }
    default: {
      // the Heart: a machine core with a living glow
      const p = new Pix(28, 28);
      p.circle(14, 14, 12, 0x5a1d14);
      p.circle(14, 14, 10.5, 0xb3261e);
      p.circle(14, 14, 8, 0xff7a2a);
      p.circle(14, 14, 5.5, 0xffe07a);
      p.circle(13, 13, 2.5, 0xffffff);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        p.rect(Math.round(14 + Math.cos(a) * 11) - 1, Math.round(14 + Math.sin(a) * 11) - 1, 3, 3, 0xe8d48a);
      }
      p.outline(INK);
      return p;
    }
  }
}
