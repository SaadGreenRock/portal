import fs from "node:fs";
import type { Browser } from "puppeteer-core";

/**
 * HTML → PDF via headless Chrome.
 *
 * Chrome specifically, because the vouchers carry an Urdu Nastaliq paragraph.
 * Nastaliq needs full OpenType shaping — contextual joining, mark positioning,
 * ligature substitution — which the JS PDF libraries do not implement; they
 * would emit disconnected, unreadable letterforms. Chrome ships HarfBuzz and
 * gets it right.
 *
 * The browser is kept warm between renders: the first voucher pays ~1s of
 * launch cost, every one after it renders in a couple of hundred milliseconds.
 */

const MAC_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const LINUX_CHROME = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
];

const WIN_CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function findLocalChrome(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates =
    process.platform === "darwin"
      ? MAC_CHROME
      : process.platform === "win32"
        ? WIN_CHROME
        : LINUX_CHROME;
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let browserPromise: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  const local = findLocalChrome();

  if (local) {
    return puppeteer.launch({
      executablePath: local,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    });
  }

  // No system Chrome — assume a serverless host with @sparticuz/chromium installed.
  try {
    const mod = await import("@sparticuz/chromium" as string);
    const chromium = (mod.default ?? mod) as {
      executablePath: (input?: string) => Promise<string>;
      args: string[];
      headless: boolean | "shell";
    };
    return puppeteer.launch({
      executablePath: await chromium.executablePath(),
      args: chromium.args,
      headless: true,
    });
  } catch {
    throw new Error(
      "No Chrome found for PDF rendering. Install Google Chrome, or set CHROME_PATH " +
        "to a Chrome/Chromium binary, or `npm i @sparticuz/chromium` when deploying serverless.",
    );
  }
}

async function browser(): Promise<Browser> {
  if (!browserPromise) browserPromise = launch();
  try {
    const b = await browserPromise;
    if (b.connected) return b;
  } catch {
    // fall through and relaunch
  }
  // The warm instance died (host slept, process reaped) — start a fresh one.
  browserPromise = launch();
  return browserPromise;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const b = await browser();
  const page = await b.newPage();
  try {
    // The HTML has no external references — fonts and logos are inlined — so
    // "domcontentloaded" is genuinely all we need to wait for.
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    // Belt and braces: make sure the inlined @font-face faces are parsed before
    // layout is measured, or the first render can fall back to a system font.
    await page.evaluateHandle("document.fonts.ready");
    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/** Closes the warm browser. Used by the dev server on teardown. */
export async function shutdownRenderer(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}
