import { generateWorld } from '../../src/gen/generate';
import { ORES } from '../../src/core/materials';
import { GROUND_ROW } from '../../src/core/balance';
const t=Date.now();
const w = generateWorld(12345);
console.log('gen ms', Date.now()-t, 'size', w.w, w.h, 'pickups', w.pickups.length, 'ws', w.waystations.length, 'lm', w.landmarks.map(l=>l.id+'@'+(l.y-GROUND_ROW)));
const oc: Record<string,number> = {};
for (let i=0;i<w.ore.length;i++) if (w.ore[i]) oc[ORES[w.ore[i]].key]=(oc[ORES[w.ore[i]].key]||0)+1;
console.log(oc);
const chars='.gdcs#CGbAiIBmVXFvxwLDrSP';
for (let y=0;y<70;y++){ let r=''; for(let x=0;x<w.w;x++){ const o=w.ore[w.idx(x,y)]; r+= o? String.fromCharCode(48+ (o%10)) : chars[w.mat[w.idx(x,y)]]; } console.log(String(y-GROUND_ROW).padStart(4), r); }
