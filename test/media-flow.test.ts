import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDownloadJob, getDownloadJob } from "@/lib/jobs.ts";
import { POST as inspectPost } from "@/app/api/inspect/route.ts";
import { POST as jobsPost } from "@/app/api/jobs/route.ts";
import { errorKindOf, inspectMedia } from "@/lib/yt-dlp.ts";
import type { CreateJobInput } from "@/lib/types.ts";

// ---------------------------------------------------------------------------
// Harness: put a fixture `yt-dlp` on PATH and drive the real job pipeline.
// No network access, no browser profiles, no real cookies are ever read.
// ---------------------------------------------------------------------------

const MEDIA_URL = "https://example.com/media/3100000000000000000";
const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const THREADS_URL = "https://www.threads.com/@example/post/POST_ID";

const fixtureDir = mkdtempSync(join(tmpdir(), "media-fixture-"));
const binDir = join(fixtureDir, "bin");
mkdirSync(binDir, { recursive: true });
const fakeYtDlp = join(binDir, "yt-dlp");
copyFileSync(fileURLToPath(new URL("./fixtures/fake-yt-dlp.mjs", import.meta.url)), fakeYtDlp);
chmodSync(fakeYtDlp, 0o755);

process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
const argvLog = join(fixtureDir, "yt-dlp-argv.log");
process.env.FAKE_YTDLP_LOG = argvLog;

const createdDirs = new Set<string>();

function setMode(mode: string) {
  process.env.FAKE_YTDLP_MODE = mode;
}

function clearLog() {
  writeFileSync(argvLog, "");
}

/** Every argv array the fixture received since the last clearLog(). */
function loggedArgvs(): string[][] {
  const raw = readFileSync(argvLog, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function lastArgv(): string[] {
  const all = loggedArgvs();
  assert.ok(all.length > 0, "expected the fixture yt-dlp to have been invoked");
  return all[all.length - 1];
}

async function waitForJob(id: string): Promise<ReturnType<typeof getDownloadJob>> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const job = getDownloadJob(id);
    if (job && ["complete", "error"].includes(job.status)) {
      if (job.destination === "download" && job.filename) {
        // remember temp dirs for cleanup
        createdDirs.add(job.id);
      }
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(`job ${id} did not settle (last status: ${job?.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function job(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    url: MEDIA_URL,
    type: "video",
    quality: "best",
    format: "mp4",
    destination: "download",
    ...overrides,
  };
}

after(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
  for (const id of createdDirs) {
    rmSync(join(tmpdir(), "media-downloader", id), { recursive: true, force: true });
  }
});

test("inspect and download routes work without the removed cookie feature", async () => {
  // Old client auth and an old environment setting must no longer read cookies.
  process.env.MEDIA_DOWNLOADER_COOKIE_FILE = "/unused/old-cookies.txt";
  const request = (body: object) => new Request("http://localhost/api/test", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, auth: { cookiesFromBrowser: "chrome" } }),
  });
  try {
    setMode("media-mixed");
    clearLog();
    const inspected = await inspectPost(request({ url: MEDIA_URL }));
    assert.equal(inspected.status, 200);
    assert.equal((await inspected.json()).items.length, 3);
    assert.ok(!lastArgv().includes("--cookies"));
    assert.ok(!lastArgv().includes("--cookies-from-browser"));

    setMode("video");
    const response = await jobsPost(request(job()));
    assert.equal(response.status, 202);
    const created = await response.json();
    const finished = await waitForJob(created.id);
    assert.equal(finished?.status, "complete");
    assert.ok(finished?.fileUrl);
    assert.ok(!lastArgv().includes("--cookies"));
    assert.ok(!lastArgv().includes("--cookies-from-browser"));
  } finally {
    delete process.env.MEDIA_DOWNLOADER_COOKIE_FILE;
  }
});

// ---------------------------------------------------------------------------
// Inspection: multi-item media enumeration
// ---------------------------------------------------------------------------

test("inspect enumerates mixed media items", async () => {
  setMode("media-mixed");
  clearLog();

  const media = await inspectMedia(MEDIA_URL);

  assert.equal(media.source, "Web");
  assert.equal(media.items?.length, 3);
  assert.equal(media.items?.[0].hasVideo, true);
  assert.equal(media.items?.[1].hasImage, true);
  assert.equal(media.items?.[1].hasVideo, false);
  assert.deepEqual(media.items?.[1].imageContainers, ["jpg"]);
  assert.equal(media.items?.[2].hasVideo, true);

  const argv = lastArgv();
  assert.ok(!argv.includes("--cookies-from-browser"));
  assert.ok(!argv.includes("--cookies"));
});


test("an public media failure is an auth error, not 'unavailable'", async () => {
  setMode("auth-fail");
  clearLog();

  await assert.rejects(inspectMedia(MEDIA_URL), (error: unknown) => {
    assert.equal(errorKindOf(error), "auth");
    assert.match((error as Error).message, /requires a login/i);
    assert.doesNotMatch((error as Error).message, /expired/i);
    return true;
  });
});

// ---------------------------------------------------------------------------
// Job pipeline: saving, error kinds, and failure handling
// ---------------------------------------------------------------------------

test("image media saves in its original container with no format conversion", async () => {
  setMode("image");
  clearLog();

  const created = createDownloadJob(
    job({ type: "image", format: "original", quality: undefined, itemIndex: 2 }),
  );
  const finished = await waitForJob(created.id);

  assert.equal(finished?.status, "complete");
  assert.match(finished?.filename ?? "", /\.jpg$/);
  assert.ok(finished?.filename && !finished.filename.endsWith(".part"));

  const argv = lastArgv();
  assert.ok(!argv.includes("--format"), "image must not select a format");
  assert.ok(!argv.includes("--extract-audio"));
  assert.ok(!argv.includes("--merge-output-format"));
  assert.ok(!argv.includes("--cookies-from-browser"));
  assert.equal(argv[argv.indexOf("--playlist-items") + 1], "2");
});

test("video media saves an .mp4 and keeps format/merge flags", async () => {
  setMode("video");
  clearLog();

  const created = createDownloadJob(
    job({ type: "video", format: "mp4", quality: "best", itemIndex: 1 }),
  );
  const finished = await waitForJob(created.id);

  assert.equal(finished?.status, "complete");
  assert.match(finished?.filename ?? "", /\.mp4$/);

  const argv = lastArgv();
  assert.ok(argv.includes("--format"));
  assert.equal(argv[argv.indexOf("--merge-output-format") + 1], "mp4");
  assert.equal(argv[argv.indexOf("--playlist-items") + 1], "1");
});

test("an anonymous download sends no cookie arguments (legacy regression)", async () => {
  setMode("video");
  clearLog();

  const created = createDownloadJob(job());
  const finished = await waitForJob(created.id);

  assert.equal(finished?.status, "complete");
  const argv = lastArgv();
  assert.ok(!argv.includes("--cookies-from-browser"));
  assert.ok(!argv.includes("--cookies"));
});


test("an unavailable media is distinct from an auth failure", async () => {
  setMode("unavailable");
  clearLog();

  const created = createDownloadJob(job());
  const finished = await waitForJob(created.id);

  assert.equal(finished?.status, "error");
  assert.equal(finished?.errorKind, "unavailable");
  assert.match(finished?.error ?? "", /unavailable or has expired/i);
  assert.doesNotMatch(finished?.error ?? "", /requires a login/i);
});

test("a zero-byte output is reported as an output failure", async () => {
  setMode("empty");
  clearLog();

  const created = createDownloadJob(job());
  const finished = await waitForJob(created.id);

  assert.equal(finished?.status, "error");
  assert.equal(finished?.errorKind, "output");
  assert.match(finished?.error ?? "", /empty or invalid/i);
});

test("a missing output file is reported as an output failure", async () => {
  setMode("no-file");
  clearLog();

  const created = createDownloadJob(job());
  const finished = await waitForJob(created.id);

  assert.equal(finished?.status, "error");
  assert.equal(finished?.errorKind, "output");
  assert.match(finished?.error ?? "", /could not be located/i);
});

test("an already-downloaded output resolves to the surviving file path", async () => {
  setMode("already-downloaded");
  clearLog();

  const created = createDownloadJob(job());
  const finished = await waitForJob(created.id);

  assert.equal(finished?.status, "complete");
  assert.match(finished?.filename ?? "", /\.mp4$/);
});

// ---------------------------------------------------------------------------
// Regressions for the pre-existing download paths
// ---------------------------------------------------------------------------

test("YouTube inspect/download still work anonymously (regression)", async () => {
  setMode("youtube");
  clearLog();
  const media = await inspectMedia(YOUTUBE_URL);
  assert.equal(media.source, "YouTube");
  assert.equal(media.hasVideo, true);
  assert.ok(!lastArgv().includes("--cookies-from-browser"));

  setMode("video");
  const created = createDownloadJob(job({ url: YOUTUBE_URL, type: "video", format: "mp4" }));
  const finished = await waitForJob(created.id);
  assert.equal(finished?.status, "complete");
  assert.match(finished?.filename ?? "", /\.mp4$/);
});

test("Threads extractor metadata is still accepted (regression)", async () => {
  setMode("threads");
  clearLog();
  const media = await inspectMedia(THREADS_URL);
  assert.equal(media.source, "Threads");
  assert.equal(media.hasVideo, true);
});

test("unsupported URLs still classify as unsupported (regression)", async () => {
  setMode("unsupported");
  clearLog();
  await assert.rejects(inspectMedia("https://example.invalid/x"), (error: unknown) => {
    assert.equal(errorKindOf(error), "unsupported");
    return true;
  });
});
