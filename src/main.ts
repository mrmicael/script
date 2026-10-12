// Boot and glue: platform, save, simulation, scene and interface. The game is
// playable on the first frame: no title screen, no menu before the first dive.

import '@fontsource/lilita-one/latin-400.css';
import '@fontsource-variable/nunito/wght.css';
import './ui/style.css';
import Phaser from 'phaser';
import { sfx } from './audio/audio';
import { BIOMES, GROUND_ROW, METERS_PER_TILE, type UpgradeId } from './core/balance';
import { ARTIFACTS, KEYSTONES } from './core/content';
import { setLang, t, type StrKey } from './i18n/strings';
import { Controls } from './input/input';
import { createBridge, type PlatformBridge } from './platform';
import { WorldScene, type SceneHost } from './render/WorldScene';
import { artifactIconUrls } from './render/textures';
import { Bot, BOT_STYLES } from './sim/bot';
import { Game, type GameEvent, type Haul, type Input } from './sim/game';
import { SAVE_KEY, SETTINGS_KEY, loadProfile, loadSettings, newProfile, type Settings } from './sim/profile';
import { UI } from './ui/ui';

const query = new URLSearchParams(location.search);
const DEV = import.meta.env.DEV;

class Controller implements SceneHost {
  game!: Game;
  ui!: UI;
  controls = new Controls();
  settings!: Settings;
  scene!: WorldScene;
  private saveT = 0;
  private gameplayOn = false;
  private recallArmedT = 0;
  private pendingHaul: Haul | null = null;
  private haulDelay = 0;
  private bot: Bot | null = null;
  private tipsShown = new Set<string>();
  private firstInputAt = 0;
  private readyAt = 0;

  constructor(private platform: PlatformBridge) {}

  async start(): Promise<void> {
    this.platform.loadingStart();
    await this.platform.init().catch(() => {});
    this.settings = loadSettings(this.platform.getItem(SETTINGS_KEY));
    setLang(this.settings.lang || this.platform.locale());
    const { profile, status } = loadProfile(this.platform.getItem(SAVE_KEY));
    if (DEV && query.has('fresh')) Object.assign(profile, newProfile(Number(query.get('seed')) || undefined));
    this.game = new Game(profile);
    for (const tip of profile.tips) this.tipsShown.add(tip);
    if (status === 'corrupt') console.warn('[save] unreadable save replaced by a new one');

    sfx.musicVol = this.settings.music;
    sfx.sfxVol = this.settings.sfx;
    sfx.muted = this.platform.muted();
    this.platform.onMuteChange((m) => {
      sfx.muted = m;
      sfx.applyVolumes();
    });
    this.platform.onPauseChange((p) => {
      if (p) this.pause();
    });
    this.platform.onSaveError((msg) => this.ui?.toast(t('saveFailed', { msg })));

    this.ui = new UI(() => this.game, {
      buy: (id) => this.buy(id),
      launch: (from) => this.launch(from),
      closeWorkshop: () => this.closeModal(),
      resume: () => this.closeModal(),
      openWorkshop: () => this.openWorkshop(null),
      openSettings: () => this.ui.openSettings(),
      settingsChanged: (s) => this.applySettings(s),
      resetSave: () => this.resetSave(),
      action: () => this.doAction(),
      pause: () => this.pause(),
    }, this.controls, this.settings);
    const touchy = matchMedia('(pointer: coarse)').matches || this.platform.deviceType() === 'mobile' || this.platform.deviceType() === 'tablet';
    this.ui.setTouch(touchy);
    this.controls.onTouchDetected = () => this.ui.setTouch(true);
    this.controls.onAnyInput = () => {
      sfx.unlock();
      if (!this.firstInputAt) this.firstInputAt = performance.now();
    };
    window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });

    if (DEV && query.has('bot')) this.bot = new Bot(this.game, BOT_STYLES[query.get('bot') || 'careful'] ?? BOT_STYLES.careful);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      pixelArt: true,
      roundPixels: true,
      backgroundColor: '#5fb4ff',
      scale: { mode: Phaser.Scale.NONE, width: Math.round(innerWidth * dpr), height: Math.round(innerHeight * dpr), zoom: 1 / dpr },
      fps: { target: 60, smoothStep: true },
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      banner: false,
      audio: { noAudio: true },
      disableContextMenu: true,
    });
    const resize = () => {
      const d = Math.min(2, window.devicePixelRatio || 1);
      game.scale.setZoom(1 / d);
      game.scale.resize(Math.round(innerWidth * d), Math.round(innerHeight * d));
    };
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 200));
    game.scene.add('world', WorldScene, true, { host: this });
    this.scene = game.scene.getScene('world') as WorldScene;

    // save when the page goes away; pause so heat never ticks unseen
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.save();
        if (this.game.underground && this.ui.modal === 'none') this.pause();
        sfx.suspend(true);
      } else sfx.suspend(false);
    });
    window.addEventListener('pagehide', () => this.save());

    if (DEV) (window as unknown as Record<string, unknown>).__game = this;
  }

  // ------------------------------------------------------------ SceneHost
  ready(): void {
    this.readyAt = performance.now();
    document.getElementById('boot')?.classList.add('gone');
    this.platform.loadingStop();
    this.dailyCrate();
    if (this.game.exp && !this.bot) {
      this.ui.openResume();
      this.setGameplay(false);
    } else this.setGameplay(true);
    if (DEV) console.log(`[boot] ready in ${Math.round(this.readyAt)} ms`);
  }

  paused(): boolean {
    return this.ui.modal !== 'none';
  }

  input(): Input {
    if (this.bot) return this.bot.input(1 / 60);
    return this.controls.read();
  }

  frame(dt: number): void {
    const g = this.game;
    if (this.controls.takePause()) {
      if (this.ui.modal === 'none') this.pause();
      else if (this.ui.modal !== 'workshop' && this.ui.modal !== 'ending') this.closeModal();
    }
    if (this.controls.takeAction()) {
      if (this.ui.modal === 'workshop') this.launch(0);
      else if (this.ui.modal === 'resume' || this.ui.modal === 'pause') this.closeModal();
      else this.doAction();
    }
    this.recallArmedT = Math.max(0, this.recallArmedT - dt);
    // a short beat after banking before the report opens, so the escape lands
    if (this.pendingHaul) {
      this.haulDelay -= dt;
      if (this.haulDelay <= 0) {
        const h = this.pendingHaul;
        this.pendingHaul = null;
        if (this.bot) {
          this.bot.shop();
          const from = this.bot.launchChoice();
          if (from > 0) g.descendTo(from);
        } else this.openWorkshop(h);
      }
    }
    this.tutorial();
    this.saveT -= dt;
    if (g.dirtySave && this.saveT <= 0) this.save();
    const ps = this.scene?.toScreen(g.pod.x, g.pod.y + 0.36);
    this.ui.update(dt, ps ? { x: ps.x / (window.devicePixelRatio > 1 ? Math.min(2, window.devicePixelRatio) : 1), y: ps.y / (window.devicePixelRatio > 1 ? Math.min(2, window.devicePixelRatio) : 1) } : null);
  }

  onEvents(events: GameEvent[]): void {
    const g = this.game;
    for (const e of events) {
      switch (e.t) {
        case 'banked':
          this.pendingHaul = e.haul;
          this.haulDelay = e.haul.kind === 'escape' ? 0.45 : 0.15;
          this.saveSoon(0);
          this.platform.reportProgress(this.progressPercent());
          if (e.haul.total > 0 && e.haul.newRecord) this.platform.happytime();
          this.ui.hideHint();
          break;
        case 'biome':
          if (e.first) {
            this.ui.showBanner(t('newBiome'), t(`b_${BIOMES[e.biome].id}` as StrKey), `${Math.round(BIOMES[e.biome].top * METERS_PER_TILE)} m`);
            this.platform.happytime();
          }
          break;
        case 'landmark':
          this.ui.showBanner(t('landmarkFound'), t(`lm_${e.key}` as StrKey));
          break;
        case 'waystation':
          this.ui.showBanner(t('waystationOn'), t(`b_${BIOMES[e.biome].id}` as StrKey), t('waystationSub'));
          this.tip('lift', this.ui.root.ownerDocument.body.classList.contains('touch') ? t('hintTouchLift') : t('hintLift'), 7);
          break;
        case 'pickup':
          if (e.kind === 'artifact' && e.artifact !== undefined) {
            this.ui.showBanner(t('artifactFound'), t(`a_${ARTIFACTS[e.artifact].key}` as StrKey), ARTIFACTS[e.artifact].keystone ? `${t('keystones')} ${KEYSTONES.filter((k) => g.profile.artifacts.includes(k)).length}/${KEYSTONES.length}` : undefined, artifactIconUrls[e.artifact]);
            this.platform.happytime();
          }
          break;
        case 'depthRecord':
          this.ui.toast(t('depthRecord', { n: Math.round(e.depth * METERS_PER_TILE) }));
          break;
        case 'bonk': {
          let lvl = g.level.drill;
          const need = e.tier;
          let guard = 0;
          while (guard++ < 20 && Math.min(5, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5][lvl] ?? 5) < need) lvl++;
          if (need < 90) this.ui.showHint('tooHard', t('hintTooHard', { n: lvl + 1 }), 3);
          break;
        }
        case 'cargoFull':
          this.tip('full', t('hintFull'), 4);
          break;
        case 'doorOpen':
          this.ui.showBanner(t('lm_door'), t('doorOpen'));
          break;
        case 'ending':
          setTimeout(() => {
            this.ui.openEnding();
            this.setGameplay(false);
          }, 900);
          break;
        case 'expeditionStart':
          this.ui.hideHint('dig');
          break;
      }
    }
  }

  // ------------------------------------------------------------ flow
  private setGameplay(on: boolean): void {
    if (on === this.gameplayOn) return;
    this.gameplayOn = on;
    if (on) this.platform.gameplayStart();
    else this.platform.gameplayStop();
  }

  private openWorkshop(haul: Haul | null): void {
    this.ui.openWorkshop(haul);
    this.setGameplay(false);
    this.platform.setContext({ money: this.game.profile.money, deepest: Math.round(this.game.profile.stats.deepest) });
  }

  private closeModal(): void {
    const wasEnding = this.ui.modal === 'ending';
    this.ui.close();
    this.controls.releaseAll();
    this.setGameplay(true);
    if (wasEnding) this.save();
  }

  private pause(): void {
    if (this.ui.modal !== 'none') return;
    this.ui.openPause(this.game.mode === 'surface' && !this.game.exp);
    this.setGameplay(false);
    this.save();
  }

  private launch(from: number): void {
    this.ui.close();
    this.controls.releaseAll();
    this.setGameplay(true);
    if (from > 0) this.game.descendTo(from);
  }

  private buy(id: UpgradeId): boolean {
    const ok = this.game.buy(id);
    if (ok) this.saveSoon(0);
    return ok;
  }

  private doAction(): void {
    const g = this.game;
    sfx.unlock();
    if (g.mode === 'expedition' && g.padBiome >= 0) {
      g.rideLiftUp();
      return;
    }
    if (g.mode === 'surface' && !g.exp) {
      this.openWorkshop(null);
      return;
    }
    if (g.canRecall) {
      if (this.recallArmedT > 0) {
        g.recall();
        this.recallArmedT = 0;
      } else {
        this.recallArmedT = 2;
        this.ui.showHint('recall', t('hintRecall'), 2);
      }
    }
  }

  // ------------------------------------------------------------ coaching
  private tip(key: string, text: string, seconds = 5): void {
    if (this.tipsShown.has(key)) return;
    this.tipsShown.add(key);
    if (!this.game.profile.tips.includes(key)) this.game.profile.tips.push(key);
    this.ui.showHint(key, text, seconds);
  }

  private tutorial(): void {
    const g = this.game;
    if (this.ui.modal !== 'none' || this.bot) return;
    const touch = document.body.classList.contains('touch');
    const st = g.profile.stats;
    if (st.tiles === 0 && g.mode === 'surface' && performance.now() - this.readyAt > 2500 && !this.ui.hintShowing) this.ui.showHint('dig', touch ? t('hintTouchMove') : t('hintMove'), 4);
    if (!g.exp) return;
    const firstRun = st.escapes + st.lifts + st.recalls + st.overheats === 0;
    if (g.heatFrac > 0.3 && firstRun) this.tip('heat', t('hintHeat'), 6);
    if ((g.heatFrac > 0.45 || g.cargoCount >= Math.min(8, g.capacity) || g.depth > 16) && firstRun && this.tipsShown.has('heat') && !this.ui.hintShowing) this.tip('fly', touch ? t('hintTouchFly') : t('hintFly'), 6);
    if (!firstRun && g.heatFrac > 0.4) this.tip('escape', t('hintEscape'), 6);
    if (!firstRun && st.runs >= 2 && g.depth > 4 && g.heatFrac < 0.3) this.tip('side', t('hintSide'), 4);
    if (g.level.recall > 0 && g.heatFrac > 0.6) this.tip('recall', t('hintRecall'), 5);
  }

  /** a small crate at the surface once per calendar day; never a streak to lose */
  private dailyCrate(): void {
    const p = this.game.profile;
    const today = new Date().toISOString().slice(0, 10);
    if (!p.firstDay) {
      p.firstDay = today;
      p.lastBonusDay = today;
      return;
    }
    if (p.lastBonusDay === today) return;
    p.lastBonusDay = today;
    const amount = Math.max(50, Math.round(Math.min(p.stats.bestHaul, 20000) * 0.5 / 10) * 10);
    p.money += amount;
    this.ui.toast(t('dailyCrate', { n: '$' + amount.toLocaleString('en') }));
    this.saveSoon(0);
  }

  private progressPercent(): number {
    const p = this.game.profile;
    const depth = Math.min(1, p.stats.deepest / 370);
    const keys = KEYSTONES.filter((k) => p.artifacts.includes(k)).length / KEYSTONES.length;
    return p.ended ? 100 : Math.round((depth * 0.6 + keys * 0.4) * 99);
  }

  // ------------------------------------------------------------ persistence
  private saveSoon(seconds: number): void {
    this.game.dirtySave = true;
    this.saveT = Math.min(this.saveT, seconds);
  }

  save(): void {
    if (!this.game) return;
    try {
      this.platform.setItem(SAVE_KEY, JSON.stringify(this.game.snapshot()));
      this.game.dirtySave = false;
      this.saveT = 4;
    } catch (e) {
      console.warn('[save]', e);
    }
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    this.ui.settings = s;
    sfx.musicVol = s.music;
    sfx.sfxVol = s.sfx;
    sfx.applyVolumes();
    setLang(s.lang || this.platform.locale());
    try {
      this.platform.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* storage off: settings last for this session */
    }
  }

  private resetSave(): void {
    this.platform.setItem(SAVE_KEY, '');
    location.reload();
  }
}

const platform = createBridge([SAVE_KEY, SETTINGS_KEY], (local) => (local ? 'local' : 'cloud'));
const controller = new Controller(platform);
controller.start().catch((e) => {
  console.error(e);
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = 'Could not start the game. Please reload.';
});
void GROUND_ROW;
