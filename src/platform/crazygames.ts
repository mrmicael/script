// CrazyGames HTML5 SDK v3. Checked against docs.crazygames.com (requirements,
// SDK intro, video ads, game, user, data) on 2026-10-08.

import { LocalPlatformBridge, loadScript, within, type AdResult, type DeviceType, type PlatformAccount } from './bridge';

interface CGAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (e: unknown) => void;
}

interface CGUser {
  username: string;
  profilePictureUrl?: string;
}

interface CGSDK {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    gameplayStart(): void;
    gameplayStop(): void;
    loadingStart(): void;
    loadingStop(): void;
    happytime(): void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(cb: (s: { muteAudio?: boolean }) => void): void;
    reportGameCompletedPercentage?(percent: number): void;
    setGameContext?(context: Record<string, string | number>): void;
    clearGameContext?(): void;
  };
  ad: {
    requestAd(type: 'midgame' | 'rewarded', cb: CGAdCallbacks): void;
  };
  data: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
  user?: {
    isUserAccountAvailable?: boolean;
    systemInfo?: { locale?: string; device?: { type?: string } };
    getUser?(): Promise<CGUser | null>;
    showAuthPrompt?(): Promise<CGUser | null>;
    addAuthListener?(cb: (user: CGUser | null) => void): void;
  };
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CGSDK };
  }
}

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

const toAccount = (u: CGUser | null | undefined): PlatformAccount | null => (u && u.username ? { name: u.username, avatar: u.profilePictureUrl || null } : null);

export class CrazyGamesPlatformBridge extends LocalPlatformBridge {
  readonly name: string = 'crazygames';
  private sdk: CGSDK | null = null;
  private inGameplay = false;
  private adBusy = false;
  private storageReady = true;
  private sessionSave = new Map<string, string>();
  private user: PlatformAccount | null = null;
  private accountCbs: ((a: PlatformAccount | null) => void)[] = [];
  private progress = -1;
  private loginOpen = false;

  get loginLabel(): string | null {
    return this.accountsOn() && !this.user ? 'Log in' : null;
  }
  get loginHint(): string | null {
    return this.loginLabel ? 'Keep your progress on every device' : null;
  }

  async init(): Promise<void> {
    try {
      if (!window.CrazyGames) await loadScript(SDK_URL, 6000);
      const sdk = window.CrazyGames?.SDK;
      if (!sdk) throw new Error('no sdk');
      await within(sdk.init(), 10000, 'sdk init');
      this.sdk = sdk;
      this.adsEnabled = sdk.environment === 'crazygames';
    } catch (e) {
      console.warn('[platform] CrazyGames SDK unavailable, running locally', e);
      this.sdk = null;
      return;
    }
    // the player's CrazyGames profile: shown on the home screen, never stored
    if (this.accountsOn()) {
      try {
        this.user = toAccount(await within(this.sdk.user!.getUser!(), 4000, 'getUser'));
      } catch {
        this.user = null;
      }
      try {
        // with the Data Module the SDK reloads the game itself after a login; this only refreshes the chip
        this.sdk.user!.addAuthListener?.((u) => {
          this.user = toAccount(u);
          for (const cb of this.accountCbs) cb(this.user);
        });
      } catch {
        /* older SDK */
      }
    }
  }

  private live(): CGSDK | null {
    return this.sdk && this.sdk.environment !== 'disabled' ? this.sdk : null;
  }

  private accountsOn(): boolean {
    const u = this.live()?.user;
    return !!u && u.isUserAccountAvailable === true && typeof u.getUser === 'function';
  }

  private safe(fn: (sdk: CGSDK) => void): void {
    const sdk = this.live();
    if (!sdk) return;
    try {
      fn(sdk);
    } catch (e) {
      console.warn('[platform]', e);
    }
  }

  loadingStart(): void {
    this.safe((s) => s.game.loadingStart());
  }
  loadingStop(): void {
    this.safe((s) => s.game.loadingStop());
  }
  gameplayStart(): void {
    if (this.inGameplay) return;
    this.inGameplay = true;
    this.safe((s) => s.game.gameplayStart());
  }
  gameplayStop(): void {
    if (!this.inGameplay) return;
    this.inGameplay = false;
    this.safe((s) => s.game.gameplayStop());
  }
  happytime(): void {
    this.safe((s) => s.game.happytime());
  }
  getItem(key: string): string | null {
    const sdk = this.live();
    if (sdk) {
      try {
        return sdk.data.getItem(key);
      } catch (error) {
        // Never replace unread cloud progress with a stale browser-local save.
        this.storageReady = false;
        console.warn('[platform] Cloud save could not be read; progress stays in this session.', error);
        return this.sessionSave.get(key) ?? null;
      }
    }
    return super.getItem(key);
  }
  setItem(key: string, value: string): void {
    const sdk = this.live();
    if (sdk) {
      this.sessionSave.set(key, value);
      if (!this.storageReady) return;
      try {
        sdk.data.setItem(key, value);
      } catch (error) {
        console.warn('[platform] Cloud save failed; session progress retained.', error);
      }
      return;
    }
    super.setItem(key, value);
  }

  private request(type: 'midgame' | 'rewarded', onStart: () => void): Promise<AdResult> {
    if (!this.sdk || !this.adsEnabled || this.adBusy) return Promise.resolve('unavailable');
    this.adBusy = true;
    return new Promise<AdResult>((resolve) => {
      let done = false;
      const finish = (r: AdResult) => {
        if (done) return; // the SDK must never resume us twice
        done = true;
        clearTimeout(watchdog);
        this.adBusy = false;
        resolve(r);
      };
      // safety net: never leave the player stuck behind an ad that never reports back
      let watchdog = setTimeout(() => finish('error'), 15000);
      let started = false;
      try {
        this.sdk!.ad.requestAd(type, {
          adStarted: () => {
            if (done || started) return;
            started = true;
            clearTimeout(watchdog);
            watchdog = setTimeout(() => finish('error'), 120000);
            onStart();
          },
          adFinished: () => {
            clearTimeout(watchdog);
            finish('finished');
          },
          adError: () => {
            clearTimeout(watchdog);
            finish('error');
          },
        });
      } catch {
        clearTimeout(watchdog);
        finish('error');
      }
    });
  }

  midgameAd(onStart: () => void): Promise<AdResult> {
    return this.request('midgame', onStart);
  }
  rewardedAd(onStart: () => void): Promise<AdResult> {
    return this.request('rewarded', onStart);
  }
  locale(): string {
    return this.sdk?.user?.systemInfo?.locale ?? navigator.language ?? 'en';
  }
  muted(): boolean {
    return !!this.sdk?.game.settings?.muteAudio;
  }
  onMuteChange(cb: (muted: boolean) => void): void {
    try {
      this.sdk?.game.addSettingsChangeListener?.((s) => cb(!!s.muteAudio));
    } catch {
      /* older SDK: no listener */
    }
  }
  deviceType(): DeviceType | null {
    const t = this.sdk?.user?.systemInfo?.device?.type;
    return t === 'desktop' || t === 'tablet' || t === 'mobile' ? t : null;
  }
  account(): PlatformAccount | null {
    return this.user;
  }
  login(): void {
    const u = this.live()?.user;
    if (!u?.showAuthPrompt || this.loginOpen) return;
    this.loginOpen = true;
    u.showAuthPrompt()
      .then((user) => {
        this.user = toAccount(user);
        for (const cb of this.accountCbs) cb(this.user);
      })
      .catch(() => {
        /* cancelled, or already signed in */
      })
      .finally(() => {
        this.loginOpen = false;
      });
  }
  onAccountChange(cb: (account: PlatformAccount | null) => void): void {
    this.accountCbs.push(cb);
  }
  reportProgress(percent: number): void {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    if (p === this.progress) return;
    this.progress = p;
    this.safe((s) => s.game.reportGameCompletedPercentage?.(p));
  }
  setContext(context: Record<string, string | number> | null): void {
    this.safe((s) => (context ? s.game.setGameContext?.(context) : s.game.clearGameContext?.()));
  }
}
