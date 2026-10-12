import { describe, expect, it } from 'vitest';
import { GROUND_ROW, HEAT, WORLD, UPGRADES, UPGRADE_ORDER } from '../src/core/balance';
import { M, MATERIALS, O, ORES } from '../src/core/materials';
import { decodeRemoved, encodeRemoved } from '../src/core/world';
import { generateWorld } from '../src/gen/generate';
import { LANGS, setLang, t } from '../src/i18n/strings';
import { Game, type Input } from '../src/sim/game';
import { loadProfile, loadSettings, newProfile } from '../src/sim/profile';

const idle: Input = { x: 0, up: false, down: false };
const down: Input = { ...idle, down: true };
const up: Input = { ...idle, up: true };
function step(g: Game, seconds: number, input = idle, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) g.update(1 / fps, input);
}
function diving(seed = 12345) {
  const g = new Game(newProfile(seed));
  step(g, 2, down);
  expect(g.exp).not.toBeNull();
  return g;
}
function reload(g: Game) {
  return new Game(loadProfile(JSON.stringify(g.snapshot())).profile);
}

describe('playable expedition', () => {
  it('digs, earns a haul, banks exactly once, upgrades and resumes saved progress', () => {
    const g = diving();
    step(g, 5, down);
    expect(g.profile.stats.tiles).toBeGreaterThan(3);
    expect(g.heat).toBeGreaterThan(0);
    // A known ore encountered in the expedition exercises collection and accounting.
    const x = Math.floor(g.pod.x), y = Math.floor(g.pod.y) + 1;
    g.world.mat[g.world.idx(x, y)] = M.DIRT;
    g.world.ore[g.world.idx(x, y)] = O.TOPAZ;
    g.breakTile(x, y);
    const cargo = g.cargoValue;
    expect(cargo).toBeGreaterThan(0);
    step(g, 12, up);
    expect(g.mode).toBe('surface');
    expect(g.profile.money).toBe(cargo);
    expect(g.events.filter(e => e.t === 'banked')).toHaveLength(1);
    step(g, 2, up);
    expect(g.profile.money).toBe(cargo);
    expect(g.events.filter(e => e.t === 'banked')).toHaveLength(1);
    const before = g.drillPower;
    expect(g.buy('drill')).toBe(true);
    expect(g.drillPower).toBeGreaterThan(before);
    const copy = reload(g);
    expect(copy.profile.money).toBe(cargo - UPGRADES.drill.costs[0]);
    expect(copy.level.drill).toBe(1);
    expect(copy.world.removed).toEqual(g.world.removed);
  });

  it('restores mid-drill from safe contact without losing cargo or duplicating ore', () => {
    const g = diving();
    g.exp!.chestMoney = 137;
    for (let i = 0; i < 600; i++) {
      g.update(1 / 120, down);
      if (g.drill && g.drill.t / g.drill.dur > 0.7) break;
    }
    expect(g.drill).not.toBeNull();
    const copy = reload(g);
    expect(copy.exp?.chestMoney).toBe(137);
    expect(copy.boxBlocked(copy.pod.x, copy.pod.y)).toBe(false);
    expect(copy.world.removed).toEqual(g.world.removed);
    step(copy, 2, up);
    expect(copy.profile.money).toBeGreaterThanOrEqual(137);
  });

  it('preserves failure across reload and never takes banked money or upgrades', () => {
    const g = diving();
    g.profile.money = 500;
    g.profile.upgrades.drill = 1;
    g.exp!.chestMoney = 400;
    g.addHeat(1000);
    const copy = reload(g);
    expect(copy.mode).toBe('overheat');
    step(copy, HEAT.breakdownTime + HEAT.towTime + 0.1);
    expect(copy.profile.money).toBe(600);
    expect(copy.level.drill).toBe(1);
    expect(copy.exp).toBeNull();
    expect(reload(copy).profile.money).toBe(600);
    expect(copy.events.filter(e => e.t === 'banked')).toHaveLength(1);
  });

  it('recovers invalid saved positions with a single deposit', () => {
    const g = diving();
    g.exp!.chestMoney = 120;
    const cargo = g.cargoValue;
    const p = loadProfile(JSON.stringify(g.snapshot())).profile;
    p.expedition!.x = -10;
    const recovered = new Game(p);
    expect(recovered.profile.money).toBe(cargo);
    expect(recovered.exp).toBeNull();
    expect(reload(recovered).profile.money).toBe(cargo);
  });

  it('rejects unaffordable purchases and enforces maximum levels', () => {
    const g = new Game(newProfile(1));
    expect(g.buy('drill')).toBe(false);
    g.profile.money = 1e7;
    for (const id of UPGRADE_ORDER) {
      for (let i = 0; i < UPGRADES[id].costs.length; i++) expect(g.buy(id)).toBe(true);
      const money = g.profile.money;
      expect(g.buy(id)).toBe(false);
      expect(g.profile.money).toBe(money);
    }
    step(g, 2, down);
    expect(g.buy('drill')).toBe(false);
  });

  it('caps cargo and replaces a cheaper item with a rare ore', () => {
    const g = diving();
    g.exp!.cargo.fill(0);
    const x = 3, y = GROUND_ROW + 2, i = g.world.idx(x,y);
    for (let n = 0; n < g.capacity + 5; n++) {
      g.world.mat[i] = M.DIRT; g.world.ore[i] = O.COPPER; g.breakTile(x,y);
    }
    expect(g.cargoCount).toBe(g.capacity);
    g.world.mat[i] = M.DIRT; g.world.ore[i] = O.TOPAZ; g.breakTile(x,y);
    expect(g.exp!.cargo[O.TOPAZ]).toBe(1);
    expect(g.cargoCount).toBe(g.capacity);
    expect(g.cargoValue).toBe((g.capacity - 1) * ORES[O.COPPER].value + ORES[O.TOPAZ].value);
  });

  it('simulates the same drill and heat at 15, 30, 60 and 120 FPS', () => {
    const states = [15,30,60,120].map(fps => {
      const g = new Game(newProfile(13)); step(g, 8, down, fps);
      return [g.pod.x, g.pod.y, g.heat, g.profile.stats.tiles];
    });
    for (const state of states) state.forEach((n,i) => expect(n).toBeCloseTo(states[0][i],5));
  });

  it('ignores non-finite time and heat; caps catch-up after inactivity', () => {
    const g = diving();
    const time = g.time, heat = g.heat;
    g.update(NaN, down); g.update(-1, down); g.addHeat(NaN);
    expect(g.time).toBe(time); expect(g.heat).toBe(heat);
    g.update(600, idle);
    expect(g.time - time).toBeLessThanOrEqual(0.251);
  });

  it('estimates the real winding tunnel instead of cutting through walls', () => {
    const g = new Game(newProfile(5));
    g.world.mat.fill(M.BEDROCK); g.world.ore.fill(0);
    const yy = GROUND_ROW + 20;
    for (let x = 10; x <= 30; x++) g.world.clear(x, yy);
    for (let y = GROUND_ROW - 1; y <= yy; y++) g.world.clear(30, y);
    g.pod.x = 10.5; g.pod.y = yy + 0.5;
    const route = g.escapeEstimate();
    expect(route.heat).toBeGreaterThan(20);
    expect(Number.isFinite(route.seconds)).toBe(true);
    for (let y = GROUND_ROW - 1; y < yy; y++) g.world.clear(10, y);
    g.worldRev++;
    expect(g.escapeEstimate().heat).toBeLessThan(route.heat);
  });
});

describe('generation and data', () => {
  it('is deterministic and produces valid ores, pickups and accessible lift rooms across 40 seeds', () => {
    const a = generateWorld(44), b = generateWorld(44);
    expect(a.mat).toEqual(b.mat); expect(a.ore).toEqual(b.ore);
    for (let seed = 0; seed < 40; seed++) {
      const w = generateWorld(seed);
      expect(w.mat.length).toBe(WORLD.width * (WORLD.depth + WORLD.skyRows));
      for (let i=0; i<w.mat.length; i++) {
        if (!MATERIALS[w.mat[i]]) throw new Error(`Invalid material seed ${seed}`);
        if (w.ore[i] && !MATERIALS[w.mat[i]].solid) throw new Error(`Floating ore seed ${seed}`);
      }
      for (const p of w.pickups) expect(w.solid(p.x,p.y),`pickup ${seed}/${p.id}`).toBe(false);
      for (const ws of w.waystations) {
        expect(w.solid(ws.x,ws.y)).toBe(false);
        expect(w.get(ws.x,ws.y+1)).toBe(M.PAD);
      }
      expect(w.waystations).toHaveLength(5);
    }
  });
  it('roundtrips removed tiles and rejects truncated masks', () => {
    const mask = Uint8Array.from({length:500}, (_,i) => i%7 === 0 ? 1 : 0);
    expect(decodeRemoved(encodeRemoved(mask),500)).toEqual(mask);
    expect(decodeRemoved('zzz',500)).toBeNull();
    expect(decodeRemoved('2.3',500)).toBeNull();
  });
  it('repairs malformed saves and preserves valid progress', () => {
    for (const raw of ['null', '{', '"bad"']) expect(() => loadProfile(raw)).not.toThrow();
    const p = loadProfile(JSON.stringify({money:425, upgrades:{drill:999}, stats:{deepest:75}})).profile;
    expect(p.money).toBe(425); expect(p.stats.deepest).toBe(75);
    expect(p.upgrades.drill).toBe(UPGRADES.drill.costs.length);
    expect(loadProfile('{"money":-1}').profile.money).toBe(0);
    expect(loadSettings('null').music).toBeGreaterThan(0);
  });
  it('has complete localization keys and matching placeholders', () => {
    for (const [code,dict] of Object.entries(LANGS)) {
      expect(Object.keys(dict).sort(),code).toEqual(Object.keys(LANGS.en).sort());
      for (const key of Object.keys(LANGS.en) as (keyof typeof LANGS.en)[]) {
        expect((dict[key].match(/\{\w+\}/g) ?? []).sort(),`${code}/${key}`).toEqual((LANGS.en[key].match(/\{\w+\}/g) ?? []).sort());
      }
    }
    setLang('pt-BR'); expect(t('workshop')).toBe('Oficina'); setLang('en');
  });
});
