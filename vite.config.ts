import { defineConfig, loadEnv } from 'vite';

// `--mode crazygames` puts the CrazyGames SDK <script> first in <head>, as
// their docs ask; `--mode playgama` does the same with the Playgama Bridge and
// ships its config next to index.html; `--mode y8` loads the Y8 SDK with
// `async`, as the Y8 snippet does. The default build contacts none of them.
const PLATFORM_SDK: Record<string, string> = {
  crazygames: '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>',
  playgama: '<script src="https://bridge.playgama.com/v2/stable/playgama-bridge.js"></script>',
  y8: '<script src="https://cdn.y8.com/minimal-sdk/2-0/y8.min.js" async></script>',
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const platform = mode in PLATFORM_SDK ? mode : env.VITE_PLATFORM || '';
  const sdk = PLATFORM_SDK[platform];
  return {
    base: './',
    define: sdk ? { 'import.meta.env.VITE_PLATFORM': JSON.stringify(platform) } : {},
    plugins: [
      {
        name: 'platform-sdk',
        transformIndexHtml(html: string) {
          if (!sdk) return html;
          return html.replace('<head>', `<head>\n    ${sdk}`);
        },
        generateBundle() {
          if (platform !== 'playgama') return;
          const config = {
            advertisement: {
              minimumDelayBetweenInterstitial: 60,
              interstitial: { placementFallback: 'level_complete' },
            },
          };
          (this as unknown as { emitFile(f: object): void }).emitFile({ type: 'asset', fileName: 'playgama-bridge-config.json', source: JSON.stringify(config, null, 2) + '\n' });
        },
      },
    ],
    build: {
      target: 'es2022',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 4000,
    },
    server: {
      watch: { ignored: ['**/qa-output/**', '**/release/**', '**/dist*/**', '**/marketing/**'] },
    },
    test: {
      include: ['tests/**/*.test.ts'],
      testTimeout: 60000,
    },
  };
}) as never;
