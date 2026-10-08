#!/usr/bin/env node
// Fixture stand-in for the real `yt-dlp` binary, used by the stories flow
// suite. It never touches the network or any browser profile. Behaviour is
// selected with FAKE_YTDLP_MODE and every invocation's argv is appended to
// FAKE_YTDLP_LOG so tests can assert exactly which flags the app builds.
//
// Inspect modes (called with --dump-single-json):
//   media-mixed   three media items: video, image, video
//   media-image   one image media item
//   youtube       one public video (regression)
//   threads       one public Threads video (regression)
//
// Failure modes (both inspect and download invocations exit 1):
//   auth-fail     the anonymous site media login error
//   unavailable   a "media no longer available" error
//   unsupported   an unsupported-URL error
//   expired       a rejected/expired stored session
//   challenge     an site login challenge/checkpoint
//   rate-limit    an HTTP 429 / too-many-requests response
//   network       a connection/timeout failure
//
// Download modes (no --dump-single-json):
//   video               writes a small .mp4 and reports its path
//   image               writes a small .jpg and reports its path
//   empty               writes a zero-byte .mp4 (empty-output failure)
//   no-file             succeeds without writing anything
//   already-downloaded  writes the file but reports it as already downloaded

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const argv = process.argv.slice(2);

if (process.env.FAKE_YTDLP_LOG) {
  appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(argv) + "\n");
}

const mode = process.env.FAKE_YTDLP_MODE ?? "youtube";

function flag(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function fail(lines) {
  process.stderr.write(lines.join("\n") + "\n");
  process.exit(1);
}

if (mode === "auth-fail") {
  fail([
    "ERROR: [generic] 3100000000000000000: Downloading webpage",
    "ERROR: [generic] 3100000000000000000: This content is unreachable.",
    "  Use --cookies-from-browser or --cookies for the authentication.",
  ]);
}
if (mode === "unavailable") {
  fail(["ERROR: [generic] 3100000000000000000: This media is no longer available"]);
}
if (mode === "unsupported") {
  fail(["ERROR: Unsupported URL: https://example.invalid/x"]);
}
if (mode === "expired") {
  fail([
    "ERROR: [generic] 3100000000000000000: Downloading webpage",
    "ERROR: [generic] 3100000000000000000: cookies expired; please log in again",
  ]);
}
if (mode === "challenge") {
  fail([
    "ERROR: [generic] 3100000000000000000: challenge_required",
    "ERROR: [generic] Confirm your identity to continue.",
  ]);
}
if (mode === "rate-limit") {
  fail([
    "ERROR: [generic] 3100000000000000000: HTTP Error 429: Too Many Requests",
  ]);
}
if (mode === "network") {
  fail([
    "ERROR: [generic] 3100000000000000000: Unable to connect: connection refused",
  ]);
}

const MEDIA_ID = "3100000000000000000";
const VIDEO_ITEM = {
  id: `${MEDIA_ID}-v1`,
  title: "Media video",
  extractor: "generic",
  extractor_key: "Generic",
  formats: [{ ext: "mp4", vcodec: "h264", acodec: "aac", height: 1920, video_ext: "mp4" }],
};
const IMAGE_ITEM = {
  id: `${MEDIA_ID}-i2`,
  title: "Media photo",
  extractor: "generic",
  extractor_key: "Generic",
  formats: [{ ext: "jpg" }],
};

if (argv.includes("--dump-single-json")) {
  const payloads = {
    "media-mixed": { entries: [VIDEO_ITEM, IMAGE_ITEM, VIDEO_ITEM] },
    "media-image": { entries: [IMAGE_ITEM] },
    youtube: {
      title: "Public video",
      extractor: "youtube",
      extractor_key: "Youtube",
      duration: 42,
      formats: [{ ext: "mp4", vcodec: "h264", acodec: "aac", height: 1080, video_ext: "mp4" }],
    },
    threads: {
      title: "Threads video",
      extractor: "threads",
      extractor_key: "Threads",
      formats: [{ ext: "mp4", vcodec: "h264", acodec: "aac", height: 1080, video_ext: "mp4" }],
    },
  };

  const payload = payloads[mode];
  if (!payload) fail([`ERROR: fixture has no inspect payload for mode "${mode}"`]);
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

// Download path: emulate yt-dlp's output template expansion.
const output = flag("--output");
if (!output) fail(["ERROR: fixture needs --output"]);

if (mode === "no-file") {
  process.stdout.write("__PROGRESS__100.0%|1.00MiB/s|00:00\n");
  process.exit(0);
}

const ext = mode === "image" ? "jpg" : "mp4";
const outPath = output
  .replace("%(title)s", mode === "image" ? "Media photo" : "Media video")
  .replace("%(id)s", mode === "image" ? `${MEDIA_ID}-i2` : `${MEDIA_ID}-v1`)
  .replace("%(ext)s", ext);

mkdirSync(dirname(outPath), { recursive: true });
if (existsSync(outPath) && argv.includes("--no-overwrites")) {
  process.stdout.write(`[download] ${outPath} has already been downloaded\n`);
  process.exit(0);
}

const bytes = mode === "empty" ? Buffer.alloc(0) : Buffer.alloc(64, 0x41);
writeFileSync(outPath, bytes);

if (mode === "already-downloaded") {
  process.stdout.write(`[download] ${outPath} has already been downloaded\n`);
  process.exit(0);
}

process.stdout.write("__PROGRESS__100.0%|1.00MiB/s|00:00\n");
process.stdout.write(`__FILE__${outPath}\n`);
