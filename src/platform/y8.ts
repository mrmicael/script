// Y8 SDK 2.x (loaded from cdn.y8.com, never bundled). Checked against
// docs.y8.com (intro, local development, authentication, advertising,
// leaderboards, achievements, cloud storage, localization, protection,
// analytics, best practices) on 2026-10-08.
//
// Guests play with a local save. A signed-in player's save also goes to Y8
// cloud storage: at most once a minute, and when they leave the page. A save
// that cannot reach Y8 is reported to the player instead of failing silently.

import { LocalPlatformBridge, loadScript, within, type AdResult, type PlatformAccount } from './bridge';
import { Y8_ACHIEVEMENTS, Y8_APP_ID, Y8_GAME_ID, Y8_TABLES } from './y8.config';

interface Y8User {
  nickname?: string;
  avatars?: { medium_secure_url?: string | null } | null;
}

interface Y8BreakInfo {
  breakStatus?: string;
}

interface Y8SDK {
  init(app: { appId: string; autoLogin: boolean }, ads?: { gameId: string; preloadAdBreaks: string; sound: string; onReady?: () => void }): void;
  onAuth(cb: (user: Y8User | null, error?: unknown) => void): void;
  login(): void;
  saveData(o: { key: string; value: string; retries?: boolean }): Promise<unknown>;
  loadData(o: { key: string }): Promise<string | null>;
  showAd(o: {
    type: string;
    name: string;
    beforeAd?: () => void;
    afterAd?: () => void;
    beforeReward?: (showAdFn: () => void) => void;
    adDismissed?: () => void;
    adViewed?: () => void;
    adBreakDone?: (info: Y8BreakInfo) => void;
  }): Promise<unknown>;
  getPlatformLocale?(): Promise<string>;
  isBlacklisted?(): Promise<boolean>;
  trackCustomEvent?(name: string, value?: number | null, amount?: number): void;
  saveLeaderboardScore?(o: { table: string; points: number }): Promise<unknown>;
  showLeaderboard?(o?: { table?: string }): Promise<unknown>;
  awardAchievement?(o: { achievement: string; achievementKey: string }): Promise<unknown>;
}

declare global {
  interface Window {
    y8?: { sdk(): Y8SDK; emitReadyEvent?(): void };
  }
}

const SDK_URL = 'https://cdn.y8.com/minimal-sdk/2-0/y8.min.js';
/** Y8 asks for auto-saves no more often than once a minute */
const CLOUD_EVERY_MS = 60000;
/** largest value cloud storage accepts */
const CLOUD_MAX = 30 * 1024;

const toAccount = (u: Y8User | null | undefined): PlatformAccount | null =>
  u ? { name: u.nickname || 'Y8 player', avatar: u.avatars?.medium_secure_url || null } : null;

const errText = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));

export class Y8PlatformBridge extends LocalPlatformBridge {
  readonly name: string = 'y8';
  private sdk: Y8SDK | null = null;
  private user: PlatformAccount | null = null;
  private authSeen = false;
  private firstAuth: ((u: Y8User | null) => void) | null = null;
  private cache = new Map<string, string>();
  /** cloud progress was read (or confirmed empty) for the signed-in player */
  private cloudOk = false;
  private lastSent: string | null = null;
  private lastCloudAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight = false;
  private loc = '';
  private adBusy = false;
  private awarded = new Set<string>();
  private accountCbs: ((a: PlatformAccount | null) => void)[] = [];
  private replacedCbs: (() => void)[] = [];
  private saveErrCbs: ((m: string) => void)[] = [];

  constructor(
    private keys: string[],
    private pick: (local: string, cloud: string) => 'local' | 'cloud',
  ) {
    super();
  }

  get loginLabel(): string | null {
    return this.sdk && !this.user ? 'Sign in with Y8' : null;
  }
  get loginHint(): string | null {
    if (!this.loginLabel) return null;
    return this.hasLeaderboard ? 'Keep your progress on every device and get on the leaderboard' : 'Keep your progress on every device';
  }
  get hasLeaderboard(): boolean {
    return !!this.sdk && Object.keys(Y8_TABLES).length > 0;
  }

  async init(): Promise<void> {
    for (const k of this.keys) {
      const v = super.getItem(k);
      if (v !== null) this.cache.set(k, v);
    }
    if (!Y8_APP_ID) {
      console.info('[platform] Y8 app id not configured: running with the local save');
      return;
    }
    try {
      // the tag in <head> is async: it may have loaded before this runs, so ask it to announce itself again
      const ready = new Promise<void>((resolve) => addEventListener('y8sdk.ready', () => resolve(), { once: true }));
      if (!document.querySelector(`script[src="${SDK_URL}"]`)) loadScript(SDK_URL, 8000).catch(() => {});
      window.y8?.emitReadyEvent?.();
      await within(ready, 8000, 'y8 ready');
      const sdk = window.y8!.sdk();
      sdk.init({ appId: Y8_APP_ID, autoLogin: true }, { gameId: Y8_GAME_ID, preloadAdBreaks: 'on', sound: 'on', onReady: () => {} });
      const first = new Promise<Y8User | null>((resolve) => (this.firstAuth = resolve));
      sdk.onAuth((user, error) => this.onAuth(user, error));
      this.sdk = sdk;
      this.adsEnabled = true;
      // a returning player is signed in automatically on y8.com; elsewhere the answer is "guest"
      const user = await within(first, 5000, 'y8 auth').catch(() => null);
      this.user = toAccount(user);
      if (this.user) await this.syncCloud(false);
      sdk.getPlatformLocale?.().then((l) => (this.loc = l || '')).catch(() => {});
    } catch (e) {
      console.warn('[platform] Y8 SDK unavailable, running locally', e);
      this.sdk = null;
      this.adsEnabled = false;
      return;
    }
    // leaving the page is the last moment the player caused: send what is pending
    const leave = () => this.flush(true);
    addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) leave();
    });
  }

  private onAuth(user: Y8User | null, error?: unknown): void {
    if (error) {
      // closed or blocked sign-in popup: stay a guest, nothing to repair
      console.warn('[platform] Y8 sign-in', errText(error));
      if (!this.authSeen) {
        this.authSeen = true;
        this.firstAuth?.(null);
      }
      return;
    }
    if (!this.authSeen) {
      this.authSeen = true;
      this.firstAuth?.(user);
      return;
    }
    const was = this.user;
    this.user = toAccount(user);
    if (!this.user) this.cloudOk = false;
    for (const cb of this.accountCbs) cb(this.user);
    if (this.user && !was) void this.syncCloud(true);
  }

  /** after a sign-in: keep whichever save holds more progress, on both sides */
  private async syncCloud(live: boolean): Promise<void> {
    const sdk = this.sdk;
    const key = this.keys[0];
    if (!sdk || !key) return;
    let cloud: string | null;
    try {
      cloud = await within(sdk.loadData({ key }), 10000, 'y8 load');
    } catch (e) {
      // never overwrite cloud progress we could not read
      this.cloudOk = false;
      console.warn('[platform] Y8 load failed', errText(e));
      this.reportSaveError('Could not reach your Y8 save. Progress is kept on this device for now.');
      return;
    }
    this.cloudOk = true;
    const local = this.cache.get(key) ?? null;
    if (cloud && (!local || this.pick(local, cloud) === 'cloud')) {
      this.cache.set(key, cloud);
      super.setItem(key, cloud);
      this.lastSent = cloud;
      if (live) for (const cb of this.replacedCbs) cb();
    } else if (local) {
      // the player just signed in: their click is the moment to upload this device's progress
      this.flush(true);
    }
  }

  private reportSaveError(message: string): void {
    for (const cb of this.saveErrCbs) cb(message);
  }

  getItem(key: string): string | null {
    return this.cache.get(key) ?? super.getItem(key);
  }
  setItem(key: string, value: string): void {
    this.cache.set(key, value);
    super.setItem(key, value);
    if (!this.user || !this.cloudOk || this.timer) return;
    const wait = Math.max(0, this.lastCloudAt + CLOUD_EVERY_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush(false);
    }, wait);
  }

  private flush(now: boolean): void {
    const sdk = this.sdk;
    const key = this.keys[0];
    if (!sdk || !key || !this.user || !this.cloudOk || this.inflight) return;
    if (now && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const value = this.cache.get(key);
    if (!value || value === this.lastSent) return;
    if (value.length > CLOUD_MAX) {
      this.reportSaveError('Your save is too large for Y8 cloud storage. It is kept on this device.');
      return;
    }
    this.inflight = true;
    this.lastCloudAt = Date.now();
    sdk
      .saveData({ key, value, retries: true })
      .then(() => {
        this.lastSent = value;
      })
      .catch((e) => {
        console.warn('[platform] Y8 save failed', errText(e));
        this.reportSaveError('Could not save to Y8. Retrying in a minute.');
        this.timer ??= setTimeout(() => {
          this.timer = null;
          this.flush(false);
        }, CLOUD_EVERY_MS);
      })
      .finally(() => {
        this.inflight = false;
        // something changed while this one was in flight
        if (this.cache.get(key) !== this.lastSent && !this.timer) this.setItem(key, this.cache.get(key)!);
      });
  }

  /** opt-in ad (type "reward"): 'finished' only when adViewed fired */
  rewardedAd(onStart: () => void): Promise<AdResult> {
    const sdk = this.sdk;
    if (!sdk || !this.adsEnabled || this.adBusy) return Promise.resolve('unavailable');
    this.adBusy = true;
    return new Promise<AdResult>((resolve) => {
      let done = false;
      let viewed = false;
      let started = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const finish = (r: AdResult) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        this.adBusy = false;
        resolve(r);
      };
      watchdog = setTimeout(() => finish('unavailable'), 6000);
      sdk
        .showAd({
          type: 'reward',
          name: 'shop-reward',
          beforeReward: (showAdFn) => showAdFn(),
          beforeAd: () => {
            if (done || started) return;
            started = true;
            clearTimeout(watchdog);
            watchdog = setTimeout(() => finish('error'), 180000);
            onStart();
          },
          adViewed: () => {
            viewed = true;
          },
          adDismissed: () => finish('unavailable'),
          afterAd: () => finish(viewed ? 'finished' : 'unavailable'),
          adBreakDone: () => finish(viewed ? 'finished' : 'unavailable'),
        })
        .catch(() => finish('error'));
    });
  }

  midgameAd(onStart: () => void): Promise<AdResult> {
    const sdk = this.sdk;
    if (!sdk || !this.adsEnabled || this.adBusy) return Promise.resolve('unavailable');
    this.adBusy = true;
    return new Promise<AdResult>((resolve) => {
      let done = false;
      let started = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const finish = (r: AdResult) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        this.adBusy = false;
        resolve(r);
      };
      // a skipped or capped break fires no ad callbacks, and an ad blocker none at all
      watchdog = setTimeout(() => finish('unavailable'), 4000);
      sdk
        .showAd({
          type: 'next',
          name: 'shift-complete',
          beforeAd: () => {
            if (done || started) return;
            started = true;
            clearTimeout(watchdog);
            watchdog = setTimeout(() => finish('error'), 120000);
            onStart();
          },
          afterAd: () => finish('finished'),
          adBreakDone: (info) => {
            if (!started) finish(info?.breakStatus === 'viewed' ? 'finished' : 'unavailable');
          },
        })
        .catch(() => finish('error'));
    });
  }
  locale(): string {
    return this.loc || navigator.language || 'en';
  }
  account(): PlatformAccount | null {
    return this.user;
  }
  login(): void {
    // straight from the click: off y8.com this opens a popup the browser only allows right away
    try {
      this.sdk?.login();
    } catch (e) {
      console.warn('[platform] Y8 login', errText(e));
    }
  }
  onAccountChange(cb: (account: PlatformAccount | null) => void): void {
    this.accountCbs.push(cb);
  }
  onProgressReplaced(cb: () => void): void {
    this.replacedCbs.push(cb);
  }
  onSaveError(cb: (message: string) => void): void {
    this.saveErrCbs.push(cb);
  }
  submitScore(board: string, score: number): void {
    const table = Y8_TABLES[board];
    const points = Math.round(score);
    if (!this.sdk?.saveLeaderboardScore || !table || !this.user || points <= 0) return;
    this.sdk.saveLeaderboardScore({ table, points }).catch((e) => console.warn('[platform] Y8 score', errText(e)));
  }
  showLeaderboard(board?: string): void {
    const table = (board && Y8_TABLES[board]) || Object.values(Y8_TABLES)[0];
    this.sdk?.showLeaderboard?.(table ? { table } : undefined)?.catch(() => {});
  }
  unlockAchievement(id: string): void {
    const a = Y8_ACHIEVEMENTS[id];
    if (!this.sdk?.awardAchievement || !a || !this.user || this.awarded.has(id)) return;
    this.awarded.add(id);
    this.sdk.awardAchievement({ achievement: a.title, achievementKey: a.key }).catch((e) => {
      // 505: already on the player's profile
      if ((e as { code?: unknown })?.code !== 505 && (e as { code?: unknown })?.code !== '505') this.awarded.delete(id);
    });
  }
  track(event: string, value?: number): void {
    try {
      this.sdk?.trackCustomEvent?.(event, value ?? null);
    } catch {
      /* analytics never blocks the game */
    }
  }
  async isUnauthorizedHost(): Promise<boolean> {
    if (!this.sdk?.isBlacklisted) return false;
    try {
      return await within(this.sdk.isBlacklisted(), 5000, 'y8 blacklist');
    } catch {
      return false;
    }
  }
}
