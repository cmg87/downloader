import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { instagramRequest } from "@/lib/instagram/client";
import type { InstagramSession } from "@/lib/instagram/types";

interface LoginWindow {
  context: BrowserContext;
  capture?: Promise<InstagramSession>;
  nextCheck: number;
  error?: string;
}
const shared = globalThis as typeof globalThis & {
  __instagramLoginWindow?: LoginWindow;
  __instagramWindowStarting?: Promise<InstagramSession>;
};
function profilePath() {
  return join(process.env.MEDIA_DOWNLOADER_INSTAGRAM_DIR || join(homedir(), ".config/media-downloader/instagram"), "browser-profile");
}

export async function startBrowserLogin(): Promise<InstagramSession> {
  if (shared.__instagramWindowStarting) return shared.__instagramWindowStarting;
  if (shared.__instagramLoginWindow) {
    const page = shared.__instagramLoginWindow.context.pages()[0];
    if (page) await page.bringToFront();
    return { state: "browser-login" };
  }
  const start = async (): Promise<InstagramSession> => {
    await mkdir(profilePath(), { recursive: true });
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(profilePath(), {
        channel: "chrome", headless: false, viewport: null, chromiumSandbox: true, timeout: 20_000,
      });
    } catch {
      throw new Error("Could not open Instagram on this PC. Check that Chrome is installed and the PC’s desktop is running.");
    }
    const window: LoginWindow = { context, nextCheck: 0 };
    shared.__instagramLoginWindow = window;
    context.on("close", () => { if (shared.__instagramLoginWindow === window) shared.__instagramLoginWindow = undefined; });
    const page = context.pages()[0] ?? await context.newPage();
    try {
      await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.bringToFront();
    } catch {
      await context.close().catch(() => undefined);
      throw new Error("Could not load Instagram’s login page. Try again when Instagram is reachable.");
    }
    return { state: "browser-login" };
  };
  shared.__instagramWindowStarting = start();
  try { return await shared.__instagramWindowStarting; }
  finally { shared.__instagramWindowStarting = undefined; }
}

export async function browserLoginStatus(): Promise<InstagramSession> {
  const window = shared.__instagramLoginWindow;
  if (!window) return instagramRequest("status");
  if (window.capture) return window.capture;
  if (Date.now() < window.nextCheck) return { state: "browser-login", message: window.error };
  // Wait until the browser has left login/checkpoint screens; pre-verification cookies alone aren't enough.
  const pages = window.context.pages();
  if (!pages.some((page) => {
    const url = new URL(page.url());
    return ["instagram.com", "www.instagram.com"].includes(url.hostname) && !/^\/(accounts|challenge|checkpoint)(\/|$)/.test(url.pathname);
  })) return { state: "browser-login" };
  window.capture = (async () => {
    try {
      const cookies = await window.context.cookies("https://www.instagram.com/");
      const values = Object.fromEntries(cookies.map((cookie) => [cookie.name, cookie.value]));
      if (!values.sessionid || !values.ds_user_id) return { state: "browser-login" as const };
      window.nextCheck = Date.now() + 60_000;
      const result = await instagramRequest<InstagramSession>("browser-session", { cookies: values });
      if (shared.__instagramLoginWindow === window) shared.__instagramLoginWindow = undefined;
      await window.context.close().catch(() => undefined);
      return result;
    } catch (error) {
      window.error = error instanceof Error ? error.message : "Could not validate the Instagram session yet.";
      return { state: "browser-login" as const, message: window.error };
    } finally { window.capture = undefined; }
  })();
  return window.capture;
}

export async function cancelBrowserLogin(clearProfile = false) {
  // Serialize cancellation with launch/capture to prevent a late callback from reconnecting after sign-out.
  await shared.__instagramWindowStarting?.catch(() => undefined);
  const window = shared.__instagramLoginWindow;
  await window?.capture?.catch(() => undefined);
  const current = shared.__instagramLoginWindow;
  shared.__instagramLoginWindow = undefined;
  await current?.context.close().catch(() => undefined);
  if (clearProfile) await rm(profilePath(), { recursive: true, force: true });
}
