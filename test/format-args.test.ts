import test from "node:test";
import assert from "node:assert/strict";

import {
  buildYtDlpArgs,
  isImageExtension,
  isOriginalPassthrough,
  OUTPUT_TEMPLATE,
  TRIM_FILENAME_LENGTH,
  outputTemplateFor,
} from "../src/lib/download-args.ts";
import type { CreateJobInput } from "../src/lib/types.ts";

function input(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    url: "https://example.com/media/3100000000000000000",
    type: "video",
    quality: "best",
    format: "mp4",
    destination: "download",
    ...overrides,
  };
}

test("image downloads use original passthrough with no format selection", () => {
  const args = buildYtDlpArgs(
    input({ type: "image", format: "original", quality: undefined }),
    "/tmp/out/%(title)s [%(id)s].%(ext)s",
  );

  assert.equal(isOriginalPassthrough(input({ type: "image", format: "original" })), true);

  assert.ok(!args.includes("--format"), "image must not pass --format");
  assert.ok(!args.includes("--extract-audio"), "image must not extract audio");
  assert.ok(!args.includes("--audio-format"), "image must not select audio format");
  assert.ok(!args.includes("--merge-output-format"), "image must not merge");
  assert.ok(!args.includes("--remux-video"), "image must not remux");
});

test("format:original passthrough also skips video/audio args", () => {
  const args = buildYtDlpArgs(
    input({ type: "video", format: "original" }),
    "/tmp/out/%(title)s [%(id)s].%(ext)s",
  );

  assert.equal(isOriginalPassthrough(input({ type: "video", format: "original" })), true);
  assert.ok(!args.includes("--format"));
  assert.ok(!args.includes("--extract-audio"));
  assert.ok(!args.includes("--merge-output-format"));
});

test("video downloads keep the format/merge/remux behaviour", () => {
  const args = buildYtDlpArgs(input({ type: "video", format: "mp4" }), "/tmp/out/%(id)s.%(ext)s");

  assert.ok(args.includes("--format"));
  const selector = args[args.indexOf("--format") + 1];
  assert.match(selector, /bestvideo/);
  assert.deepEqual(
    args.slice(args.indexOf("--merge-output-format"), args.indexOf("--merge-output-format") + 2),
    ["--merge-output-format", "mp4"],
  );
  assert.ok(args.includes("--remux-video"));
});

test("audio downloads extract audio and never merge video", () => {
  const args = buildYtDlpArgs(
    input({ type: "audio", format: "mp3", quality: undefined }),
    "/tmp/out/%(id)s.%(ext)s",
  );

  assert.deepEqual(
    args.slice(args.indexOf("--extract-audio"), args.indexOf("--extract-audio") + 4),
    ["--extract-audio", "--audio-format", "mp3", "--audio-quality"],
  );
  assert.ok(!args.includes("--format"));
  assert.ok(!args.includes("--merge-output-format"));
});

test("always passes deterministic, non-destructive download flags", () => {
  const args = buildYtDlpArgs(input(), "/tmp/out/%(id)s.%(ext)s");

  assert.ok(args.includes("--ignore-config"));
  assert.ok(args.includes("--no-playlist"));
  assert.ok(args.includes("--no-overwrites"), "must not clobber an existing file");
  assert.equal(args[args.indexOf("--trim-filenames") + 1], String(TRIM_FILENAME_LENGTH));
  assert.equal(args[args.indexOf("--output") + 1], "/tmp/out/%(id)s.%(ext)s");
});

test("selecting a media item adds --playlist-items", () => {
  const args = buildYtDlpArgs(input({ itemIndex: 3 }), "/tmp/out/%(id)s.%(ext)s");
  assert.deepEqual(
    args.slice(args.indexOf("--playlist-items"), args.indexOf("--playlist-items") + 2),
    ["--playlist-items", "3"],
  );
});

test("extra args land just before the URL separator", () => {
  const args = buildYtDlpArgs(input(), "/tmp/out/%(id)s.%(ext)s", [
    "--user-agent",
    "DownloaderTest",
  ]);

  const separator = args.indexOf("--");
  assert.equal(args[separator - 2], "--user-agent");
  assert.equal(args[separator - 1], "DownloaderTest");
  assert.equal(args.at(-1), input().url);
});

test("output template and image-extension helper stay stable", () => {
  assert.equal(OUTPUT_TEMPLATE, "%(title)s [%(id)s].%(ext)s");
  assert.equal(
    outputTemplateFor("/home/me/Videos/Downloader"),
    "/home/me/Videos/Downloader/%(title)s [%(id)s].%(ext)s",
  );
  assert.equal(isImageExtension("JPG"), true);
  assert.equal(isImageExtension("webp"), true);
  assert.equal(isImageExtension("mp4"), false);
  assert.equal(isImageExtension(undefined), false);
});
