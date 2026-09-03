/**
 * Channel B: Playwright attached over CDP to a dedicated, headed, real Chrome profile
 * (C:\dev\asa-chrome-profile, port 9222). The runtime never launches headless Chromium against a
 * marketplace and never touches the user's Default profile.
 *
 * Block detection is read-only: it reads the page text once, returns a boolean and discards the text.
 * A DataDome block or CAPTCHA is a STOP, never something to work around.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const CHANNEL_B_PROFILE = 'C:\\dev\\asa-chrome-profile';

export interface ChannelB {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  launched: boolean;
}

export function cdpAlive(cdpUrl: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(new URL('/json/version', cdpUrl), (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export interface LaunchOptions {
  chromeExe?: string;
  profileDir?: string;
  port?: number;
}

/** Start the dedicated Chrome (headed) detached from this process. Returns the pid. */
export function launchChannelBChrome(opts: LaunchOptions = {}): number | undefined {
  const exe = opts.chromeExe ?? CHROME_EXE;
  const profile = opts.profileDir ?? CHANNEL_B_PROFILE;
  const port = opts.port ?? 9222;
  if (!fs.existsSync(exe)) throw new Error(`chrome.exe not found: ${exe}`);
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child.pid;
}

export interface ConnectOptions extends LaunchOptions {
  /** Launch chrome.exe with the channel-B flags if the CDP port is closed (default true). */
  launchIfDown?: boolean;
  timeoutMs?: number;
}

export async function connectChannelB(cdpUrl: string, opts: ConnectOptions = {}): Promise<ChannelB> {
  const launchIfDown = opts.launchIfDown ?? true;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let launched = false;
  if (!(await cdpAlive(cdpUrl))) {
    if (!launchIfDown) throw new Error(`CDP endpoint ${cdpUrl} is not reachable`);
    const port = Number(new URL(cdpUrl).port || 9222);
    launchChannelBChrome({ ...opts, port });
    launched = true;
    const deadline = Date.now() + timeoutMs;
    while (!(await cdpAlive(cdpUrl))) {
      if (Date.now() > deadline) throw new Error(`Chrome did not open ${cdpUrl} within ${timeoutMs} ms`);
      await sleep(500);
    }
  }
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: timeoutMs });
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const pages = context.pages().filter((p) => !p.url().startsWith('devtools://') && !p.url().startsWith('chrome://'));
  const page = pages[0] ?? (await context.newPage());
  return { browser, context, page, launched };
}

export const BLOCK_MARKERS: readonly RegExp[] = [
  /you have been blocked/i,
  /captcha-delivery\.com/i,
  /geo\.captcha-delivery/i,
  /datadome/i,
  /potwierd[zź],?\s+[żz]e\s+nie\s+jeste[śs]\s+robotem/i,
  /nie jeste[śs] robotem/i,
  /verify you are human/i,
  /press & hold/i,
];

export interface BlockCheck {
  blocked: boolean;
  marker?: string;
}

/** Read-only: reads body text + iframe sources once, returns only a verdict. Never returns the text. */
export async function detectBlock(page: Page): Promise<BlockCheck> {
  const probe = await page.evaluate(() => {
    const text = (document.body && (document.body as HTMLElement).innerText) || '';
    const frames = Array.from(document.querySelectorAll('iframe')).map((f) => f.getAttribute('src') || '');
    return { text: text.slice(0, 20000), frames };
  });
  for (const re of BLOCK_MARKERS) {
    if (re.test(probe.text)) return { blocked: true, marker: re.source };
    for (const f of probe.frames) if (re.test(f)) return { blocked: true, marker: `iframe:${re.source}` };
  }
  return { blocked: false };
}

/** Logged-in check: Allegro shows the account menu for a logged-in user. Read-only, boolean only. */
export async function detectLoggedIn(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const t = ((document.body && (document.body as HTMLElement).innerText) || '').toLowerCase();
    if (t.includes('zaloguj się') && !t.includes('wyloguj')) return false;
    return t.includes('moje allegro') || t.includes('wyloguj') || t.includes('moje zakupy');
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
