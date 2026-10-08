import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import { chromium } from "playwright-core";
import { startBrowserLogin, browserLoginStatus, cancelBrowserLogin } from "../src/lib/instagram/browser-login.ts";

// Test the real login coordinator and Python bridge with a simulated browser.
// No browser starts and no credentials are sent to Instagram in these tests.
test("browser login waits for verification, validates cookies, saves once and closes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "instagram-browser-"));
  process.env.MEDIA_DOWNLOADER_INSTAGRAM_DIR = root;
  process.env.MEDIA_DOWNLOADER_INSTAGRAM_PYTHON = "python3";
  process.env.PYTHONPATH = resolve("test/fixtures/instagram");
  process.env.PYTHONDONTWRITEBYTECODE = "1";
  const bridge = globalThis as typeof globalThis & { __instagramBridge?: { child: ChildProcess } };
  t.after(async () => { await cancelBrowserLogin(); bridge.__instagramBridge?.child.kill(); await rm(root, { recursive: true, force: true }); });
  let url = "about:blank";
  let closed = 0;
  let launches = 0;
  const page = { url: () => url, goto: async (next: string) => { url = next; }, bringToFront: async () => undefined };
  const context = Object.assign(new EventEmitter(), {
    pages: () => [page], newPage: async () => page,
    cookies: async () => [{ name: "sessionid", value: "fake" }, { name: "ds_user_id", value: "123" }, { name: "fake_username", value: "example" }],
    close: async () => { closed++; context.emit("close"); },
  });
  t.mock.method(chromium, "launchPersistentContext", async (directory: string, options: { headless: boolean; channel: string }) => {
    launches++;
    assert.equal(directory, join(root, "browser-profile"));
    assert.equal(options.headless, false);
    assert.equal(options.channel, "chrome");
    return context;
  });
  assert.equal((await startBrowserLogin()).state, "browser-login");
  assert.equal(url, "https://www.instagram.com/accounts/login/");
  assert.equal((await startBrowserLogin()).state, "browser-login");
  assert.equal(launches, 1);
  assert.equal((await browserLoginStatus()).state, "browser-login");
  url = "https://www.instagram.com/challenge/123/";
  assert.equal((await browserLoginStatus()).state, "browser-login");
  assert.equal(closed, 0);
  url = "https://www.instagram.com/";
  const [first, second] = await Promise.all([browserLoginStatus(), browserLoginStatus()]);
  assert.deepEqual(first, { state: "connected", username: "example" });
  assert.deepEqual(second, first);
  assert.equal(closed, 1);
  const saved = JSON.parse(await readFile(join(root, "session.json"), "utf8"));
  assert.equal(saved.username, "example");
  assert.equal((await browserLoginStatus()).state, "connected");
  await startBrowserLogin();
  await cancelBrowserLogin(true);
  assert.equal(closed, 2);
});
