import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Focused coverage for the two user-facing actions:
//
//   Save / This PC      -> destination "server": a permanent file under the
//                          configured PC save directory, exposed via savedPath.
//   Download / This device -> destination "download": staged in the temp dir,
//                          surfaced as /api/jobs/<id>/file and streamed to the
//                          requesting browser as an attachment.
//
// A server filesystem write must NEVER be presented as a device download, and
// vice versa. This suite proves the two handlers stay distinct.
//
// The fixture `yt-dlp` is put on PATH so the real job pipeline runs with no
// network access, and MEDIA_DOWNLOADER_SAVE_DIR points the PC save at a temp
// directory so the user's real $HOME/Videos/Downloader is never touched.
// ---------------------------------------------------------------------------

const MEDIA_URL = "https://example.com/media/3100000000000000000";

const fixtureDir = mkdtempSync(join(tmpdir(), "dest-fixture-"));
const binDir = join(fixtureDir, "bin");
mkdirSync(binDir, { recursive: true });
const fakeYtDlp = join(binDir, "yt-dlp");
copyFileSync(fileURLToPath(new URL("./fixtures/fake-yt-dlp.mjs", import.meta.url)), fakeYtDlp);
chmodSync(fakeYtDlp, 0o755);
process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;

const saveDir = mkdtempSync(join(tmpdir(), "pc-save-"));
process.env.MEDIA_DOWNLOADER_SAVE_DIR = saveDir;
const argvLog = join(fixtureDir, "yt-dlp-argv.log");
process.env.FAKE_YTDLP_LOG = argvLog;

function setMode(mode: string) {
  process.env.FAKE_YTDLP_MODE = mode;
}

// Import AFTER the environment is set: jobs.ts reads the save-dir override at
// module load, and the route module pulls the same singleton job store.
const { createDownloadJob, getDownloadJob } = await import("@/lib/jobs.ts");
const { GET: getFileRoute } = await import("@/app/api/jobs/[id]/file/route.ts");

const createdJobDirs = new Set<string>();

async function waitForJob(id: string) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const job = getDownloadJob(id);
    if (job && ["complete", "error"].includes(job.status)) {
      createdJobDirs.add(id);
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(`job ${id} did not settle (last status: ${job?.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function mediaJob(destination: "server" | "download") {
  return {
    url: MEDIA_URL,
    type: "video" as const,
    quality: "best" as const,
    format: "mp4" as const,
    destination,
    itemIndex: 1,
  };
}

after(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
  rmSync(saveDir, { recursive: true, force: true });
  for (const id of createdJobDirs) {
    rmSync(join(tmpdir(), "media-downloader", id), { recursive: true, force: true });
  }
});

test("Save / This PC writes real media into the PC save directory", async () => {
  setMode("video");
  writeFileSync(argvLog, "");

  const created = createDownloadJob(mediaJob("server"));
  const finished = await waitForJob(created.id);

  assert.equal(finished?.status, "complete");
  assert.equal(finished?.destination, "server");
  assert.match(finished?.filename ?? "", /\.mp4$/);

  // Distinct handler #1: a permanent path on this PC, not a browser download.
  assert.ok(finished?.savedPath, "a PC save must expose the saved path");
  assert.ok(
    finished.savedPath.startsWith(saveDir + "/"),
    `saved path should live under the configured save dir, got ${finished.savedPath}`,
  );
  assert.equal(finished?.fileUrl, undefined, "a PC save must not offer a browser file URL");

  const info = statSync(finished.savedPath);
  assert.ok(info.isFile(), "the saved path must be a real file");
  assert.ok(info.size > 0, "the saved file must not be empty");
});

test("Download / This device stages media and exposes a browser file URL", async () => {
  setMode("video");
  writeFileSync(argvLog, "");

  const created = createDownloadJob(mediaJob("download"));
  const finished = await waitForJob(created.id);

  assert.equal(finished?.status, "complete");
  assert.equal(finished?.destination, "download");
  assert.match(finished?.filename ?? "", /\.mp4$/);

  // Distinct handler #2: nothing is written to the PC save directory; the file
  // is staged under the temp job dir and offered to the device over HTTP.
  assert.equal(finished?.savedPath, undefined, "a device download must not claim a PC path");
  assert.equal(finished?.fileUrl, `/api/jobs/${created.id}/file`);
});

test("the download route streams a device download as an attachment", async () => {
  setMode("video");
  writeFileSync(argvLog, "");

  const created = createDownloadJob(mediaJob("download"));
  const finished = await waitForJob(created.id);
  assert.equal(finished?.status, "complete");

  const response = await getFileRoute(new Request("http://localhost/"), {
    params: Promise.resolve({ id: created.id }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/octet-stream");
  assert.match(response.headers.get("Content-Disposition") ?? "", /attachment/);
  assert.ok(Number(response.headers.get("Content-Length")) > 0);

  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 0, "the streamed body must contain the media bytes");
});

test("the download route refuses a PC save (a disk write is not a device download)", async () => {
  setMode("video");
  writeFileSync(argvLog, "");

  const created = createDownloadJob(mediaJob("server"));
  const finished = await waitForJob(created.id);
  assert.equal(finished?.status, "complete");

  const response = await getFileRoute(new Request("http://localhost/"), {
    params: Promise.resolve({ id: created.id }),
  });

  assert.equal(response.status, 404);
});
