import { join } from "node:path";

import type {
  AudioFormat,
  CreateJobInput,
  DownloadQuality,
  VideoFormat,
} from "./types";

/**
 * Pure yt-dlp argument construction and filename policy.
 *
 * This module deliberately keeps no runtime `@/` imports so it can be imported
 * directly by `node --test` (native TypeScript type stripping). Optional
 * arguments are appended by the caller via the `extraArgs` parameter.
 */

/** Id-tagged, extension-preserving output template used for every download. */
export const OUTPUT_TEMPLATE = "%(title)s [%(id)s].%(ext)s";

/** yt-dlp caps the rendered filename at this many bytes. */
export const TRIM_FILENAME_LENGTH = 180;

/** Longest sanitized segment (used by the X fallback naming path). */
export const MAX_FILENAME_SEGMENT = 110;

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "avif",
  "bmp",
]);

/**
 * Strip path separators, control characters and reserved punctuation from a
 * caller-supplied name segment, collapse whitespace and cap its length. Used
 * when yt-dlp's own template cannot be relied on (X fallback) and to name the
 * download for any future caller.
 */
export function sanitizeFileSegment(
  value: string,
  maxLength: number = MAX_FILENAME_SEGMENT,
): string {
  return value
    .replace(/[^\p{L}\p{N} ._-]/gu, " ")
    // Collapse dot runs (kills "../.." style traversal and stray dots) and
    // drop leading/trailing dots so the result is a plain safe segment.
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Absolute output template for a destination directory. */
export function outputTemplateFor(outputDir: string): string {
  return join(outputDir, OUTPUT_TEMPLATE);
}

/** True when the media is an image or the caller asked to keep the original. */
export function isOriginalPassthrough(input: CreateJobInput): boolean {
  return input.type === "image" || input.format === "original";
}

/** Whether a format extension is a still image the pipeline can save as-is. */
export function isImageExtension(ext: string | undefined): boolean {
  return Boolean(ext && IMAGE_EXTENSIONS.has(ext.toLowerCase()));
}

export function buildYtDlpArgs(
  input: CreateJobInput,
  outputTemplate: string,
  extraArgs: readonly string[] = [],
): string[] {
  const args = [
    "--ignore-config",
    "--no-playlist",
    // Never clobber an existing file in the persistent server directory.
    // A skipped download still reports its existing path (parsed by spawnDownload).
    "--no-overwrites",
    "--no-colors",
    "--newline",
    "--trim-filenames",
    String(TRIM_FILENAME_LENGTH),
    "--progress-template",
    "download:__PROGRESS__%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
    "--print",
    "after_move:__FILE__%(filepath)s",
    "--output",
    outputTemplate,
  ];

  if (input.itemIndex) args.push("--playlist-items", String(input.itemIndex));

  // Image passthrough: keep the extractor's original container, apply no
  // format selection, merging, remuxing or audio extraction.
  if (!isOriginalPassthrough(input)) {
    if (input.type === "audio") {
      args.push(
        "--extract-audio",
        "--audio-format",
        input.format as AudioFormat,
        "--audio-quality",
        "0",
      );
    } else {
      const format = input.format as VideoFormat;
      args.push("--format", videoSelector(input.quality ?? "best", format));
      args.push("--merge-output-format", format, "--remux-video", format);
    }
  }

  // Optional extra arguments are appended before the URL.
  args.push(...extraArgs);

  args.push("--", input.url);
  return args;
}

function videoSelector(quality: DownloadQuality, format: VideoFormat): string {
  const height = typeof quality === "number" ? `[height<=${quality}]` : "";

  if (format === "mp4") {
    return [
      `bestvideo${height}[ext=mp4]+bestaudio[ext=m4a]`,
      `best${height}[ext=mp4]`,
      `bestvideo${height}+bestaudio`,
      `best${height}`,
      "best",
    ].join("/");
  }

  if (format === "webm") {
    return [
      `bestvideo${height}[ext=webm]+bestaudio[ext=webm]`,
      `best${height}[ext=webm]`,
    ].join("/");
  }

  return [`bestvideo${height}+bestaudio`, `best${height}`, "best"].join("/");
}
