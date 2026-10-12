import { generateWorld } from '../../src/gen/generate';
import { GROUND_ROW } from '../../src/core/balance';
import { MATERIALS } from '../../src/core/materials';
const w = generateWorld(12345);
let bad = 0;
for (let i = 0; i < w.mat.length; i++) if (w.ore[i] && !MATERIALS[w.mat[i]].solid) { bad++; if (bad < 5) console.log('ore in non-solid', i % w.w, Math.floor(i / w.w) - GROUND_ROW, MATERIALS[w.mat[i]].key); }
console.log('bad', bad);
const y = GROUND_ROW + 62; console.log('39,62', MATERIALS[w.get(39, y)].key, w.oreAt(39, y));
