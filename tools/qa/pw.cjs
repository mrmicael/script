// Shared Playwright launcher for QA scripts.
// PLAYWRIGHT_MODULE can point at any playwright install; falls back to the
// one shipped with the local Codex runtime, then to a global `playwright`.
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'C:/Users/micae/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    'playwright',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* next */
    }
  }
  throw new Error('playwright not found; set PLAYWRIGHT_MODULE');
}

async function launch(opts = {}) {
  const { chromium } = loadPlaywright();
  let exe;
  try {
    exe = chromium.executablePath();
  } catch {
    exe = null;
  }
  if (!exe || !fs.existsSync(exe)) exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    headless: opts.headless !== false,
    executablePath: exe,
    args: process.env.PW_ARGS ? process.env.PW_ARGS.split(' ') : [],
  });
  return browser;
}

function outDir() {
  const d = path.resolve(__dirname, '../../qa-output');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const BASE = process.env.BASE || 'http://127.0.0.1:5221/';

module.exports = { launch, outDir, BASE };
