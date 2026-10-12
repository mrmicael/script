import { LocalPlatformBridge, type PlatformBridge } from './bridge';
import { CrazyGamesPlatformBridge } from './crazygames';
import { PlaygamaPlatformBridge } from './playgama';
import { Y8PlatformBridge } from './y8';

export type { AdResult, PlatformAccount, PlatformBridge } from './bridge';
export type SavePicker = (local: string, cloud: string) => 'local' | 'cloud';

/** set by `vite build --mode <platform>`; undefined in the plain build */
const BUILD = import.meta.env.VITE_PLATFORM as string | undefined;

/**
 * A portal build talks only to its own portal: BUILD is a constant there, so
 * the other adapters (and every mention of other portals) drop out of the
 * bundle. The plain build can borrow one for local testing with ?cg, ?pg or ?y8.
 */
export function createBridge(saveKeys: string[], pick: SavePicker): PlatformBridge {
  return BUILD === 'crazygames'
    ? new CrazyGamesPlatformBridge()
    : BUILD === 'playgama'
      ? new PlaygamaPlatformBridge(saveKeys)
      : BUILD === 'y8'
        ? new Y8PlatformBridge(saveKeys, pick)
        : testBridge(saveKeys, pick);
}

function testBridge(saveKeys: string[], pick: SavePicker): PlatformBridge {
  const q = new URLSearchParams(location.search);
  if (q.has('cg')) return new CrazyGamesPlatformBridge();
  if (q.has('pg')) return new PlaygamaPlatformBridge(saveKeys);
  if (q.has('y8')) return new Y8PlatformBridge(saveKeys, pick);
  return new LocalPlatformBridge();
}
