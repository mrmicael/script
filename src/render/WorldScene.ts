// The one gameplay scene. Draws the world from the simulation, turns its
// events into particles, sound and interface feedback, and never decides
// anything about the rules itself.

import Phaser from 'phaser';
import { sfx } from '../audio/audio';
import { BIOMES, GROUND_ROW, HEAT, LIGHT_RADIUS, WORLD, biomeIndexAt } from '../core/balance';
import { decorLocal, decorType, DOOR_STAMP, LANDMARKS, WAYSTATION_STAMP } from '../core/landmarks';
import { M, MATERIALS, O, ORES } from '../core/materials';
import type { Game, GameEvent, Input } from '../sim/game';
import { FRAMES_PER_MAT, TILE, VARIANTS, terrainFrame } from './art/terrain';
import { ORE_VARIANTS } from './art/ores';
import { POD_CX, POD_CY, drillLook } from './art/pod';
import { paintCoreTextures, paintLandmarkTextures, paintPodTextures } from './textures';

export interface SceneHost {
  game: Game;
  /** called every frame before the simulation step */
  input(): Input;
  /** the simulation produced events this frame */
  onEvents(events: GameEvent[]): void;
  /** true while a menu or panel is covering the game */
  paused(): boolean;
  settings: { shake: boolean; reducedMotion: boolean; quality: 'auto' | 'high' | 'low' };
  /** the scene finished building and is drawing */
  ready(): void;
  frame(dt: number): void;
}

const T = TILE;
const hashCell = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

export class WorldScene extends Phaser.Scene {
  host!: SceneHost;
  private map!: Phaser.Tilemaps.Tilemap;
  private terrain!: Phaser.Tilemaps.TilemapLayer;
  private oreLayer!: Phaser.Tilemaps.TilemapLayer;
  private backdrop!: Phaser.Tilemaps.TilemapLayer;
  private decorLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private backDecorLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private decorGid: number[] = [];
  private backDecorGid: number[] = [];
  private pod!: Phaser.GameObjects.Container;
  private podBody!: Phaser.GameObjects.Image;
  private podDrill!: Phaser.GameObjects.Image;
  private podFlame!: Phaser.GameObjects.Image;
  private podGlow!: Phaser.GameObjects.Image;
  private headlight!: Phaser.GameObjects.Image;
  private crack!: Phaser.GameObjects.Image;
  private darkness!: Phaser.GameObjects.Image;
  private sky!: Phaser.GameObjects.Image;
  private hillsFar!: Phaser.GameObjects.TileSprite;
  private hillsNear!: Phaser.GameObjects.TileSprite;
  private clouds: Phaser.GameObjects.Image[] = [];
  private pickupSprites = new Map<number, Phaser.GameObjects.Image>();
  private glowPool: Phaser.GameObjects.Image[] = [];
  private pingPool: Phaser.GameObjects.Image[] = [];
  private chunks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private steam!: Phaser.GameObjects.Particles.ParticleEmitter;
  private exhaust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private texts: Phaser.GameObjects.Text[] = [];
  private emitTint = 0xffffff;
  private podLevels = '';
  private drillFrame = 0;
  private treadT = 0;
  private lastCamCell = '';
  private wasThrusting = false;
  private wasDrilling = false;
  private drillDebrisT = 0;
  private shakeAmp = 0;
  private time0 = 0;
  private zoomLevel = 2;
  private lightAlpha = 0;
  private lmReady = false;
  private heatTickT = 0;
  private collectStreak = 0;
  private collectStreakT = 0;

  constructor() {
    super('world');
  }

  init(data: { host: SceneHost }): void {
    this.host = data.host;
  }

  create(): void {
    const g = this.host.game;
    const w = g.world;
    paintCoreTextures(this);
    paintPodTextures(this, g.level);
    this.podLevels = JSON.stringify(g.level);
    this.cameras.main.setBackgroundColor(0x5fb4ff);

    // sky and parallax hills (fixed to the camera, they fade out underground)
    this.sky = this.add.image(0, 0, 'sky').setOrigin(0).setDepth(-20);
    this.hillsFar = this.add.tileSprite(0, GROUND_ROW * T - 120 + 34, w.w * T * 2, 120, 'hills-far').setOrigin(0, 0).setScrollFactor(0.25, 1).setDepth(-19);
    this.hillsNear = this.add.tileSprite(0, GROUND_ROW * T - 110 + 46, w.w * T * 2, 110, 'hills-near').setOrigin(0, 0).setScrollFactor(0.5, 1).setDepth(-18);
    for (let i = 0; i < 5; i++) {
      const c = this.add.image(i * 330 + 40, 40 + (i % 3) * 46, `cloud${i % 3}`).setScrollFactor(0.15, 0.6).setDepth(-19).setAlpha(0.95);
      this.clouds.push(c);
    }

    // tilemaps
    this.map = this.make.tilemap({ tileWidth: T, tileHeight: T, width: w.w, height: w.h });
    const tsBack = this.map.addTilesetImage('backdrop', 'backdrop', T, T, 0, 0, 1)!;
    const tsTerrain = this.map.addTilesetImage('terrain', 'terrain', T, T, 0, 0, 1)!;
    const tsOre = this.map.addTilesetImage('ores', 'ores', T, T, 0, 0, 1)!;
    this.backdrop = this.map.createBlankLayer('backdrop', tsBack)!.setDepth(-10);
    this.terrain = this.map.createBlankLayer('terrain', tsTerrain)!.setDepth(0);
    this.oreLayer = this.map.createBlankLayer('ore', tsOre)!.setDepth(1);
    this.fillAll();

    // the surface: workshop, lift tower, trees, sign
    const gy = GROUND_ROW * T;
    this.add.image((WORLD.spawnX - 10) * T, gy + 2, 'workshop').setOrigin(0, 1).setDepth(-5);
    this.add.image((WORLD.spawnX + 5) * T, gy + 2, 'lift').setOrigin(0, 1).setDepth(-5);
    this.add.image((WORLD.spawnX - 1.6) * T, gy + 2, 'sign').setOrigin(0.5, 1).setDepth(-4);
    const trees: [number, number][] = [
      [2.4, 1],
      [5.2, 2],
      [8, 0],
      [37.8, 2],
      [41, 1],
      [44.6, 0],
    ];
    for (const [x, k] of trees) this.add.image(x * T, gy + 2, `pine${k}`).setOrigin(0.5, 1).setDepth(-6);
    for (const x of [11.5, 31.5, 35, 46]) this.add.image(x * T, gy + 2, 'bush').setOrigin(0.5, 1).setDepth(-4);

    // pickups
    for (const p of w.pickups) {
      if (g.profile.taken.includes(p.id)) continue;
      const key = p.kind === 'chest' ? 'chest' : p.kind === 'flask' ? 'flask' : `artifact${p.artifact}`;
      const img = this.add
        .image((p.x + 0.5) * T, (p.y + 1) * T - 1, key)
        .setOrigin(0.5, 1)
        .setDepth(2);
      this.pickupSprites.set(p.id, img);
    }

    // drilling cracks
    this.crack = this.add.image(0, 0, 'crack0').setOrigin(0).setDepth(1.5).setVisible(false);

    // the machine
    this.podGlow = this.add.image(0, 0, 'glowSoft').setBlendMode(Phaser.BlendModes.ADD).setDepth(3).setAlpha(0);
    this.podFlame = this.add.image(0, 13, 'flame0-0').setOrigin(0.5, 0).setVisible(false);
    this.podDrill = this.add.image(14, 0, 'drill0').setOrigin(0, 0.5);
    this.podBody = this.add.image(0, 0, 'pod0').setOrigin(POD_CX / 44, POD_CY / 32);
    this.pod = this.add.container(0, 0, [this.podFlame, this.podDrill, this.podBody]).setDepth(4);
    this.headlight = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(9).setAlpha(0).setScale(2.2, 1.2);

    // particles
    this.chunks = this.add.particles(0, 0, 'chunk', {
      lifespan: { min: 380, max: 750 },
      speed: { min: 50, max: 170 },
      angle: { min: 200, max: 340 },
      gravityY: 520,
      scale: { start: 1, end: 0.4 },
      rotate: { min: 0, max: 360 },
      tint: { onEmit: () => this.emitTint },
      emitting: false,
    }).setDepth(5);
    this.sparks = this.add.particles(0, 0, 'spark', {
      lifespan: { min: 200, max: 500 },
      speed: { min: 60, max: 220 },
      gravityY: 300,
      scale: { start: 1.2, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      tint: { onEmit: () => this.emitTint },
      emitting: false,
    }).setDepth(10);
    this.dust = this.add.particles(0, 0, 'puff', {
      lifespan: { min: 400, max: 800 },
      speed: { min: 8, max: 40 },
      scale: { start: 0.7, end: 2.2 },
      alpha: { start: 0.45, end: 0 },
      tint: { onEmit: () => this.emitTint },
      emitting: false,
    }).setDepth(5);
    this.steam = this.add.particles(0, 0, 'puff', {
      lifespan: { min: 600, max: 1100 },
      speedY: { min: -70, max: -30 },
      speedX: { min: -20, max: 20 },
      scale: { start: 0.6, end: 2.6 },
      alpha: { start: 0.55, end: 0 },
      tint: 0xeef4ff,
      emitting: false,
    }).setDepth(9);
    this.exhaust = this.add.particles(0, 0, 'puff', {
      lifespan: { min: 250, max: 500 },
      speedY: { min: 40, max: 110 },
      speedX: { min: -25, max: 25 },
      scale: { start: 0.5, end: 1.4 },
      alpha: { start: 0.5, end: 0 },
      tint: 0xb8b0a8,
      emitting: false,
    }).setDepth(3.5);

    // darkness over everything underground, glows on top of it
    this.darkness = this.add.image(0, 0, 'darkness').setDepth(8).setAlpha(0);
    for (let i = 0; i < 48; i++) this.glowPool.push(this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(8.5).setVisible(false));
    for (let i = 0; i < 40; i++) this.pingPool.push(this.add.image(0, 0, 'ping').setDepth(8.6).setVisible(false));

    // camera
    const cam = this.cameras.main;
    cam.setBounds(0, -6 * T, w.w * T, w.h * T + 6 * T);
    cam.startFollow(this.pod, false, 0.16, 0.16);
    this.onResize();
    this.scale.on('resize', () => this.onResize());
    this.syncPod(true);
    cam.centerOn(this.pod.x, this.pod.y);

    this.time0 = performance.now();
    this.host.ready();
    // landmark art is big and deep: paint it once the first frames are out
    this.time.delayedCall(250, () => this.buildLandmarks());
  }

  private onResize(): void {
    const cam = this.cameras.main;
    const W = this.scale.width;
    const H = this.scale.height;
    // integer zoom: about 11 tiles across the short side, at least 11 across
    const z = Math.max(1, Math.min(Math.round(Math.min(W, H) / (11.5 * T)), Math.floor(W / (10.5 * T))));
    this.zoomLevel = z;
    cam.setZoom(z);
    cam.setSize(W, H);
    this.sky.setDisplaySize(W / z + 4, H / z + 4);
    // look ahead downward: the pod sits above the middle of the screen
    cam.setFollowOffset(0, -Math.round((H / z) * 0.08));
    for (const t of this.texts) t.setResolution(z);
  }

  // ------------------------------------------------------------ tiles
  private terrainIndex(x: number, y: number): number {
    const w = this.host.game.world;
    const m = w.get(x, y);
    if (m === M.AIR) return -1;
    const md = MATERIALS[m];
    const open = (xx: number, yy: number) => {
      const n = w.get(xx, yy);
      if (md.liquid) return n === M.AIR;
      return !MATERIALS[n].solid;
    };
    let mask = 0;
    if (open(x, y - 1)) mask |= 1;
    if (open(x + 1, y)) mask |= 2;
    if (open(x, y + 1)) mask |= 4;
    if (open(x - 1, y)) mask |= 8;
    return terrainFrame(m, mask, hashCell(x, y) % VARIANTS) + 1;
  }

  private backdropIndex(x: number, y: number): number {
    if (y < GROUND_ROW) return -1;
    const w = this.host.game.world;
    const solid = (xx: number, yy: number) => MATERIALS[w.get(xx, yy)].solid;
    const b = biomeIndexAt(y - GROUND_ROW);
    let mask = 0;
    if (!solid(x, y)) {
      if (solid(x, y - 1) && y - 1 >= GROUND_ROW) mask |= 1;
      if (solid(x + 1, y)) mask |= 2;
      if (solid(x, y + 1)) mask |= 4;
      if (solid(x - 1, y)) mask |= 8;
    } else mask = 15;
    return b * 16 * VARIANTS + mask * VARIANTS + (hashCell(x, y) % VARIANTS) + 1;
  }

  private oreIndex(x: number, y: number): number {
    const o = this.host.game.world.oreAt(x, y);
    if (!o || o === O.BONE) return -1;
    return o * ORE_VARIANTS + (hashCell(x, y) % ORE_VARIANTS) + 1;
  }

  private fillAll(): void {
    const w = this.host.game.world;
    const ter: number[][] = [];
    const ore: number[][] = [];
    const back: number[][] = [];
    for (let y = 0; y < w.h; y++) {
      const tr: number[] = [];
      const or: number[] = [];
      const br: number[] = [];
      for (let x = 0; x < w.w; x++) {
        tr.push(this.terrainIndex(x, y));
        or.push(this.oreIndex(x, y));
        br.push(this.backdropIndex(x, y));
      }
      ter.push(tr);
      ore.push(or);
      back.push(br);
    }
    this.terrain.putTilesAt(ter, 0, 0, false);
    this.oreLayer.putTilesAt(ore, 0, 0, false);
    this.backdrop.putTilesAt(back, 0, 0, false);
    w.dirty.clear();
  }

  private refreshCell(x: number, y: number): void {
    const w = this.host.game.world;
    if (!w.inside(x, y)) return;
    const put = (layer: Phaser.Tilemaps.TilemapLayer, idx: number) => {
      if (idx < 0) layer.removeTileAt(x, y, false, false);
      else layer.putTileAt(idx, x, y, false);
    };
    put(this.terrain, this.terrainIndex(x, y));
    put(this.oreLayer, this.oreIndex(x, y));
    put(this.backdrop, this.backdropIndex(x, y));
    if (this.decorLayer) put(this.decorLayer, this.decorIndex(x, y));
  }

  private syncDirty(): void {
    const w = this.host.game.world;
    if (!w.dirty.size) return;
    const seen = new Set<number>();
    for (const i of w.dirty) {
      const x = i % w.w;
      const y = Math.floor(i / w.w);
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const k = (y + dy) * w.w + x + dx;
        if (seen.has(k)) continue;
        seen.add(k);
        this.refreshCell(x + dx, y + dy);
      }
    }
    w.dirty.clear();
    this.lastCamCell = '';
  }

  private decorIndex(x: number, y: number): number {
    const v = this.host.game.world.decor[this.host.game.world.idx(x, y)];
    if (!v) return -1;
    const type = decorType(v);
    const gid = this.decorGid[type];
    if (!gid) return -1;
    const [lx, ly] = decorLocal(v);
    const lw = type < LANDMARKS.length ? LANDMARKS[type].w : DOOR_STAMP.w;
    return gid + ly * lw + lx;
  }

  private buildLandmarks(): void {
    const w = this.host.game.world;
    const have = paintLandmarkTextures(this);
    const front: Phaser.Tilemaps.Tileset[] = [];
    const back: Phaser.Tilemaps.Tileset[] = [];
    let gid = 1;
    let bgid = 1;
    have.forEach((h, type) => {
      const dims = type < LANDMARKS.length ? LANDMARKS[type] : type === LANDMARKS.length ? DOOR_STAMP : WAYSTATION_STAMP;
      const count = dims.w * dims.h;
      if (h.front) {
        front.push(this.map.addTilesetImage(`lmf${type}`, `lmf${type}`, T, T, 0, 0, gid)!);
        this.decorGid[type] = gid;
        gid += count;
      }
      if (h.back) {
        back.push(this.map.addTilesetImage(`lmb${type}`, `lmb${type}`, T, T, 0, 0, bgid)!);
        this.backDecorGid[type] = bgid;
        bgid += count;
      }
    });
    this.backDecorLayer = this.map.createBlankLayer('backDecor', back)!.setDepth(-9);
    this.decorLayer = this.map.createBlankLayer('decor', front)!.setDepth(1.2);
    const fd: number[][] = [];
    const bd: number[][] = [];
    for (let y = 0; y < w.h; y++) {
      const fr: number[] = [];
      const br: number[] = [];
      for (let x = 0; x < w.w; x++) {
        fr.push(this.decorIndex(x, y));
        const v = w.backDecor[w.idx(x, y)];
        if (!v) {
          br.push(-1);
          continue;
        }
        const type = decorType(v);
        const g0 = this.backDecorGid[type];
        if (!g0) {
          br.push(-1);
          continue;
        }
        const [lx, ly] = decorLocal(v);
        const dims = type < LANDMARKS.length ? LANDMARKS[type] : type === LANDMARKS.length ? DOOR_STAMP : WAYSTATION_STAMP;
        br.push(g0 + ly * dims.w + lx);
      }
      fd.push(fr);
      bd.push(br);
    }
    this.decorLayer.putTilesAt(fd, 0, 0, false);
    this.backDecorLayer.putTilesAt(bd, 0, 0, false);
    this.lmReady = true;
  }

  // ------------------------------------------------------------ frame
  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    const g = this.host.game;
    if (!this.host.paused()) {
      g.update(dt, this.host.input());
      if (g.events.length) {
        const evs = g.events.splice(0);
        for (const e of evs) this.onEvent(e);
        this.host.onEvents(evs);
      }
    }
    this.host.frame(dt);
    this.syncDirty();
    this.syncPod(false, dt);
    this.updateEnvironment(dt);
    this.updateGlows();
  }

  private syncPod(snap: boolean, dt = 0): void {
    const g = this.host.game;
    const p = g.pod;
    const a = snap ? 1 : g.alpha;
    let x = (g.prevX + (p.x - g.prevX) * a) * T;
    let y = (g.prevY + (p.y - g.prevY) * a) * T;
    // overheated pods shake; lifts and the recall winch move the pod visually
    if (g.mode === 'overheat') {
      x += Math.sin(g.modeT * 70) * (g.modeT < HEAT.breakdownTime ? 1.5 : 0);
      if (g.modeT > HEAT.breakdownTime) y -= ((g.modeT - HEAT.breakdownTime) / HEAT.towTime) ** 2 * 400;
    } else if (g.mode === 'recall' && g.modeT > 1.8) y -= ((g.modeT - 1.8) / 1.6) ** 2 * 500;
    else if (g.mode === 'liftUp') y -= (g.modeT / 1.6) ** 2 * 300;
    if (g.drill) {
      x += (Math.random() - 0.5) * 1.2;
      y += (Math.random() - 0.5) * 1.2;
    }
    this.pod.setPosition(Math.round(x), Math.round(y));
    this.pod.setVisible(g.mode !== 'liftDown');

    // upgrades changed: repaint the machine
    const lv = JSON.stringify(g.level);
    if (lv !== this.podLevels) {
      this.podLevels = lv;
      paintPodTextures(this, g.level);
      this.podBody.setTexture('pod0');
    }

    // facing and drill placement
    const f = g.drill ? g.drill.dir : p.facing;
    const left = f === 'left' || (f !== 'right' && this.podBody.flipX);
    this.podBody.setFlipX(left);
    const look = drillLook(g.level.drill);
    const spin = g.drill ? 30 : 6;
    this.drillFrame = (this.drillFrame + dt * spin) % 4;
    this.podDrill.setTexture(`drill${Math.floor(this.drillFrame)}`);
    if (f === 'down') this.podDrill.setPosition(0, 7).setAngle(90).setFlipX(false).setFlipY(false);
    else if (f === 'up') this.podDrill.setPosition(0, -10).setAngle(-90).setFlipX(false).setFlipY(false);
    else if (left) this.podDrill.setPosition(-14, 1).setAngle(0).setFlipX(true).setOrigin(1, 0.5);
    else this.podDrill.setPosition(14, 1).setAngle(0).setFlipX(false).setOrigin(0, 0.5);
    if (f === 'down' || f === 'up') this.podDrill.setOrigin(0, 0.5);
    void look;

    // treads roll while driving
    if (Math.abs(p.vx) > 0.3 && p.grounded) {
      this.treadT += dt * Math.abs(p.vx) * 4;
      this.podBody.setTexture(Math.floor(this.treadT) % 2 ? 'pod1' : 'pod0');
    }

    // thruster
    const thrust = p.thrusting && g.mode === 'expedition' ? true : p.thrusting && g.mode === 'surface';
    this.podFlame.setVisible(thrust);
    if (thrust) {
      this.podFlame.setTexture(`flame${g.level.engine}-${Math.floor(performance.now() / 60) % 3}`);
      if (Math.random() < 0.5) this.exhaust.emitParticleAt(this.pod.x + (Math.random() - 0.5) * 6, this.pod.y + 22);
    }
    if (thrust !== this.wasThrusting) {
      sfx.thrust(thrust);
      this.wasThrusting = thrust;
    }

    // drilling feedback: cracks on the tile, debris streaming out, motor sound
    const drilling = !!g.drill;
    if (drilling) {
      const d = g.drill!;
      const k = Math.min(3, Math.floor((d.t / d.dur) * 4));
      this.crack.setVisible(true).setTexture(`crack${k}`).setPosition(d.tx * T, d.ty * T);
      this.drillDebrisT -= dt;
      if (this.drillDebrisT <= 0) {
        this.drillDebrisT = 0.045;
        const m = g.world.get(d.tx, d.ty);
        const cols = MATERIALS[m].colors;
        this.emitTint = cols[Math.floor(Math.random() * 2)];
        const cx = (d.tx + 0.5) * T + (d.dir === 'left' ? 12 : d.dir === 'right' ? -12 : 0);
        const cy = (d.ty + 0.5) * T + (d.dir === 'down' ? -12 : d.dir === 'up' ? 12 : 0);
        this.chunks.emitParticleAt(cx, cy, 1);
        if (Math.random() < 0.4) this.sparks.emitParticleAt(cx, cy, 1);
        if (this.host.settings.shake && !this.host.settings.reducedMotion) this.shakeAmp = Math.max(this.shakeAmp, 0.6);
      }
    } else this.crack.setVisible(false);
    if (drilling !== this.wasDrilling) {
      const m = drilling ? g.world.get(g.drill!.tx, g.drill!.ty) : 0;
      sfx.drill(drilling, MATERIALS[m]?.hardness ?? 1);
      this.wasDrilling = drilling;
    }

    // heat: the machine glows and steams as it gets hot
    const hf = g.heatFrac;
    const hot = Math.max(0, (hf - 0.5) / 0.5);
    this.podBody.setTint(Phaser.Display.Color.GetColor(255, Math.round(255 - hot * 110), Math.round(255 - hot * 150)));
    this.podGlow.setPosition(this.pod.x, this.pod.y).setTint(0xff5a2a).setAlpha(hot * 0.55).setScale(0.9 + hot * 0.5);
    if (hot > 0.5 && g.underground && Math.random() < hot * 0.25) this.steam.emitParticleAt(this.pod.x + (Math.random() - 0.5) * 20, this.pod.y - 10, 1);
    this.headlight.setPosition(this.pod.x + (left ? -40 : 40), this.pod.y + 2);
  }

  private updateEnvironment(dt: number): void {
    const g = this.host.game;
    const cam = this.cameras.main;
    const depth = Math.max(0, g.pod.y - GROUND_ROW);
    // darkness grows over the first few metres
    const b = BIOMES[biomeIndexAt(depth)];
    const target = g.mode === 'liftDown' ? 0 : Math.min(1, Math.max(0, (depth - 0.5) / 7)) * b.darkness;
    this.lightAlpha += (target - this.lightAlpha) * Math.min(1, dt * 3);
    this.darkness.setAlpha(this.lightAlpha).setPosition(this.pod.x, this.pod.y);
    // the hole in the darkness texture ends at 10% of its half-size
    const size = (LIGHT_RADIUS * T * 2) / 0.1;
    this.darkness.setDisplaySize(size, size);
    this.headlight.setAlpha(this.lightAlpha * 0.25);

    // sky only matters near the surface
    const camTop = cam.worldView.y;
    const showSky = camTop < GROUND_ROW * T;
    this.sky.setPosition(cam.worldView.x - 2, cam.worldView.y - 2);
    this.sky.setVisible(showSky);
    this.hillsFar.setVisible(showSky);
    this.hillsNear.setVisible(showSky);
    for (const c of this.clouds) {
      c.x += dt * 6;
      if (c.x > WORLD.width * T * 0.6 + 200) c.x = -200;
    }
    cam.setBackgroundColor(showSky ? 0x5fb4ff : BIOMES[biomeIndexAt(depth)].ambient);

    // screen shake, gentle and short
    if (this.shakeAmp > 0.05) {
      const a = this.shakeAmp;
      cam.setFollowOffset((Math.random() - 0.5) * a * 2, -Math.round((this.scale.height / this.zoomLevel) * 0.08) + (Math.random() - 0.5) * a * 2);
      this.shakeAmp *= Math.pow(0.0005, dt);
    } else if (this.shakeAmp > 0) {
      this.shakeAmp = 0;
      cam.setFollowOffset(0, -Math.round((this.scale.height / this.zoomLevel) * 0.08));
    }

    // pickups bob a little
    const now = (performance.now() - this.time0) / 1000;
    for (const [id, img] of this.pickupSprites) {
      const p = g.world.pickups.find((pp) => pp.id === id);
      if (!p) continue;
      img.y = (p.y + 1) * T - 1 + (p.kind === 'artifact' ? Math.sin(now * 2.4 + id) * 2 - 3 : 0);
    }

    // critical heat ticks
    if (g.underground && g.heatFrac >= HEAT.critical) {
      this.heatTickT -= dt;
      if (this.heatTickT <= 0) {
        this.heatTickT = 0.7;
        sfx.heatTick();
      }
    }
    sfx.setTension(g.underground ? g.heatFrac : 0);
    this.collectStreakT -= dt;
    if (this.collectStreakT <= 0) this.collectStreak = 0;
  }

  /** glows for shiny ores, lava and pickups near the camera, plus scanner pings */
  private updateGlows(): void {
    const g = this.host.game;
    const cam = this.cameras.main;
    const v = cam.worldView;
    const x0 = Math.max(0, Math.floor(v.x / T) - 1);
    const y0 = Math.max(0, Math.floor(v.y / T) - 1);
    const x1 = Math.min(g.world.w - 1, Math.ceil((v.x + v.width) / T) + 1);
    const y1 = Math.min(g.world.h - 1, Math.ceil((v.y + v.height) / T) + 1);
    const key = `${x0},${y0},${x1},${y1},${Math.floor(g.pod.x)},${Math.floor(g.pod.y)}`;
    const t = performance.now() / 1000;
    if (key !== this.lastCamCell) {
      this.lastCamCell = key;
      let gi = 0;
      let pi = 0;
      const scan = g.scanRadius;
      const px = g.pod.x;
      const py = g.pod.y;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const o = g.world.oreAt(x, y);
          const m = g.world.get(x, y);
          let col = -1;
          let size = 1;
          if (o && ORES[o].glow) {
            col = ORES[o].color;
            size = ORES[o].rarity === 'epic' ? 1.6 : ORES[o].rarity === 'rare' ? 1.3 : 1;
          } else if (m === M.LAVA && g.world.get(x, y - 1) === M.AIR) {
            col = 0xff6a2a;
            size = 1.6;
          } else if (m === M.MAGMA_ROCK || m === M.VENT) {
            col = 0xff7a2a;
            size = 0.7;
          }
          if (col >= 0 && gi < this.glowPool.length) {
            const img = this.glowPool[gi++];
            img.setVisible(true).setPosition((x + 0.5) * T, (y + 0.5) * T).setTint(col).setScale(size).setData('base', size);
          }
          // scanner: valuable ore outside the light
          if (scan > 0 && o && ORES[o].value >= 20 && pi < this.pingPool.length) {
            const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
            if (d > LIGHT_RADIUS * 0.9 && d < scan) {
              const img = this.pingPool[pi++];
              img.setVisible(true).setPosition((x + 0.5) * T, (y + 0.5) * T).setTint(ORES[o].color);
            }
          }
        }
      }
      for (; gi < this.glowPool.length; gi++) this.glowPool[gi].setVisible(false);
      for (; pi < this.pingPool.length; pi++) this.pingPool[pi].setVisible(false);
    }
    for (const img of this.glowPool) {
      if (!img.visible) break;
      const base = img.getData('base') as number;
      img.setAlpha((0.22 + 0.1 * Math.sin(t * 2.2 + img.x * 0.05)) * (0.4 + this.lightAlpha));
      img.setScale(base * (0.95 + 0.06 * Math.sin(t * 3 + img.y)));
    }
    const underground = g.underground && this.lightAlpha > 0.1;
    for (const img of this.pingPool) {
      if (!img.visible) break;
      img.setAlpha(underground ? 0.5 + 0.4 * Math.sin(t * 4 + img.x) : 0);
    }
  }

  // ------------------------------------------------------------ events
  private floatText(x: number, y: number, text: string, color: string, big = false): void {
    let tx = this.texts.find((tt) => !tt.active);
    if (!tx) {
      tx = this.add.text(0, 0, '', { fontFamily: '"Lilita One", sans-serif', fontSize: '11px', color: '#fff', stroke: '#1a1420', strokeThickness: 3 }).setOrigin(0.5).setDepth(12).setResolution(this.zoomLevel);
      this.texts.push(tx);
    }
    tx.setActive(true).setVisible(true).setText(text).setColor(color).setPosition(x, y).setAlpha(1).setFontSize(big ? 15 : 11);
    this.tweens.add({
      targets: tx,
      y: y - (big ? 34 : 24),
      alpha: { from: 1, to: 0 },
      ease: 'Cubic.easeOut',
      duration: big ? 1300 : 900,
      onComplete: () => tx!.setActive(false).setVisible(false),
    });
  }

  private burstAt(x: number, y: number, m: number, n: number): void {
    const cols = MATERIALS[m].colors;
    for (let i = 0; i < n; i++) {
      this.emitTint = cols[i % 3];
      this.chunks.emitParticleAt(x + (Math.random() - 0.5) * 18, y + (Math.random() - 0.5) * 18, 1);
    }
    this.emitTint = cols[1];
    this.dust.emitParticleAt(x, y, 2);
  }

  private onEvent(e: GameEvent): void {
    const s = this.host.settings;
    const shake = (a: number) => {
      if (s.shake && !s.reducedMotion) this.shakeAmp = Math.max(this.shakeAmp, a);
    };
    switch (e.t) {
      case 'break': {
        const x = (e.x + 0.5) * T;
        const y = (e.y + 0.5) * T;
        const md = MATERIALS[e.mat];
        this.burstAt(x, y, e.mat, md.hardness > 3 ? 12 : 8);
        if (md.sound === 'crystal' || md.sound === 'ice') {
          this.emitTint = md.colors[0];
          this.sparks.emitParticleAt(x, y, 6);
        }
        sfx.crack(md.sound, md.hardness);
        shake(md.hardness > 3 ? 2.2 : 1.4);
        break;
      }
      case 'collect': {
        const od = ORES[e.ore];
        const x = (e.x + 0.5) * T;
        const y = (e.y + 0.5) * T;
        this.emitTint = od.color;
        this.sparks.emitParticleAt(x, y, od.rarity === 'common' ? 5 : 14);
        this.collectStreak++;
        this.collectStreakT = 1.6;
        sfx.collect(od.rarity, this.collectStreak);
        this.floatText(x, y - 8, `+$${od.value}`, od.rarity === 'common' ? '#ffe9a8' : '#ffffff', od.rarity !== 'common');
        if (od.rarity === 'rare' || od.rarity === 'epic') shake(2);
        break;
      }
      case 'cargoFull':
        sfx.cargoFull();
        this.floatText((e.x + 0.5) * T, e.y * T, 'FULL', '#ff8a6a');
        break;
      case 'cool': {
        this.emitTint = 0x9ff7ff;
        this.sparks.emitParticleAt((e.x + 0.5) * T, (e.y + 0.5) * T, 10);
        this.steam.emitParticleAt(this.pod.x, this.pod.y - 6, 4);
        sfx.cool();
        this.floatText(this.pod.x, this.pod.y - 22, `−${Math.round(e.amount)}°`, '#9ff7ff');
        break;
      }
      case 'heatBurst':
        this.steam.emitParticleAt((e.x + 0.5) * T, (e.y + 0.5) * T, 10);
        this.emitTint = 0xffb347;
        this.sparks.emitParticleAt((e.x + 0.5) * T, (e.y + 0.5) * T, 12);
        sfx.steam();
        this.floatText(this.pod.x, this.pod.y - 22, `+${Math.round(e.amount)}°`, '#ff8a4a');
        shake(3);
        break;
      case 'explode': {
        const x = (e.x + 0.5) * T;
        const y = (e.y + 0.5) * T;
        this.emitTint = 0xffb347;
        this.sparks.emitParticleAt(x, y, 30);
        this.emitTint = 0x6a4a3a;
        this.dust.emitParticleAt(x, y, 10);
        const flash = this.add.image(x, y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffc070).setDepth(9).setScale(4);
        this.tweens.add({ targets: flash, alpha: 0, scale: 7, duration: 450, onComplete: () => flash.destroy() });
        sfx.explosion();
        shake(7);
        break;
      }
      case 'bonk':
        this.emitTint = 0xffffff;
        this.sparks.emitParticleAt(this.pod.x + (this.podBody.flipX ? -16 : 16), this.pod.y, 6);
        sfx.bonk();
        shake(1.2);
        break;
      case 'land':
        this.emitTint = 0xc8b8a8;
        this.dust.emitParticleAt(this.pod.x, this.pod.y + 12, 3);
        sfx.land(e.speed);
        shake(Math.min(3, e.speed / 6));
        break;
      case 'overheat':
        this.steam.emitParticleAt(this.pod.x, this.pod.y, 25);
        this.emitTint = 0xff7a2a;
        this.sparks.emitParticleAt(this.pod.x, this.pod.y, 30);
        sfx.overheat();
        sfx.drill(false);
        shake(6);
        break;
      case 'pickup': {
        const img = [...this.pickupSprites.entries()].find(([id]) => {
          const p = this.host.game.world.pickups.find((pp) => pp.id === id);
          return p && p.x === e.x && p.y === e.y;
        });
        if (img) {
          const [id, sp] = img;
          this.pickupSprites.delete(id);
          this.tweens.add({ targets: sp, y: sp.y - 30, alpha: 0, scale: 1.6, duration: 600, onComplete: () => sp.destroy() });
        }
        this.emitTint = e.kind === 'flask' ? 0x9ff7ff : 0xffd23f;
        this.sparks.emitParticleAt((e.x + 0.5) * T, (e.y + 0.5) * T, 20);
        if (e.kind === 'artifact') sfx.discovery();
        else sfx.pickup();
        if (e.value) this.floatText((e.x + 0.5) * T, e.y * T, `+$${e.value.toLocaleString('en')}`, '#ffe9a8', true);
        break;
      }
      case 'splash':
        this.emitTint = e.liquid === 'lava' ? 0xff7a2a : 0x9ee4ff;
        this.sparks.emitParticleAt(this.pod.x, this.pod.y + 8, 12);
        sfx.splash(e.liquid === 'lava');
        break;
      case 'liftStart':
        sfx.lift();
        break;
      case 'recallStart':
        sfx.recall();
        break;
      case 'biome':
        sfx.setMusicBiome(e.biome);
        if (e.first) sfx.biome();
        break;
      case 'landmark':
      case 'waystation':
        sfx.discovery();
        break;
      case 'banked':
        sfx.setMusicBiome(0);
        break;
      case 'doorOpen':
        shake(8);
        sfx.explosion();
        sfx.biome();
        break;
      case 'drillStart':
        break;
    }
  }

  /** world point (in tiles) to screen pixels, for interface hints */
  toScreen(tx: number, ty: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: (tx * T - cam.worldView.x) * cam.zoom, y: (ty * T - cam.worldView.y) * cam.zoom };
  }

  get landmarksReady(): boolean {
    return this.lmReady;
  }
}

export const FRAMES = FRAMES_PER_MAT;
