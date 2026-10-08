import { spawn } from "node:child_process";

import { classifyYtDlpError } from "@/lib/error-kind";
import type { MediaCapabilities } from "@/lib/types";
import { isImageExtension } from "@/lib/download-args";
import { getXMedia, xCapabilities, xPostId } from "@/lib/x-fallback";

export {
  YtDlpError,
  classifyYtDlpError,
  classifyYtDlpErrorKind,
  errorKindOf,
  ytDlpErrorMessage,
} from "@/lib/error-kind";

const INSPECTION_TIMEOUT_MS = 90_000;
const MAX_METADATA_BYTES = 25 * 1024 * 1024;
const MAX_ERROR_BYTES = 8_000;

interface YtDlpFormat {
  ext?: unknown;
  height?: unknown;
  vcodec?: unknown;
  acodec?: unknown;
  video_ext?: unknown;
  audio_ext?: unknown;
}

interface YtDlpMetadata {
  entries?: unknown;
  title?: unknown;
  uploader?: unknown;
  channel?: unknown;
  creator?: unknown;
  thumbnail?: unknown;
  duration?: unknown;
  extractor?: unknown;
  extractor_key?: unknown;
  formats?: unknown;
}

function isCodec(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value !== "none";
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasMediaExtension(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value !== "none";
}

function sourceLabel(extractor: string): string {
  const key = extractor.toLowerCase().split(":")[0];
  const labels: Record<string, string> = {
    youtube: "YouTube",
    youtubetab: "YouTube",
    tiktok: "TikTok",
    twitter: "X",
    instagram: "Instagram",
    facebook: "Facebook",
    vimeo: "Vimeo",
    soundcloud: "SoundCloud",
    reddit: "Reddit",
    twitch: "Twitch",
    threads: "Threads",
    generic: "Web",
  };

  if (labels[key]) return labels[key];

  // yt-dlp's `extractor_key` is the class name minus its `IE` suffix (e.g.
  // "Threads", "Youtube"), while the friendly labels above
  // are keyed by product. Match a known product as a prefix so sub
  // extractors render with the product’s familiar name.
  const product = Object.keys(labels).find((name) => key.startsWith(name));
  if (product) return labels[product];

  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Web";
}

function normalizeMetadata(raw: YtDlpMetadata): MediaCapabilities {
  const formats = Array.isArray(raw.formats)
    ? (raw.formats.filter(
        (item): item is YtDlpFormat => Boolean(item && typeof item === "object"),
      ))
    : [];

  if (formats.length === 0) {
    throw new Error("No downloadable formats were found for this URL.");
  }

  const videoFormats = formats.filter(
    (format) => isCodec(format.vcodec) || hasMediaExtension(format.video_ext),
  );
  const audioFormats = formats.filter(
    (format) => isCodec(format.acodec) || hasMediaExtension(format.audio_ext),
  );
  const imageFormats = formats.filter(
    (format) =>
      isImageExtension(cleanString(format.ext)) &&
      !isCodec(format.vcodec) &&
      !hasMediaExtension(format.video_ext),
  );
  const resolutions = Array.from(
    new Set(
      videoFormats
        .map((format) => format.height)
        .filter(
          (height): height is number =>
            typeof height === "number" && Number.isFinite(height) && height > 0,
        )
        .map((height) => Math.round(height)),
    ),
  ).sort((a, b) => b - a);

  const containers = (items: YtDlpFormat[]) =>
    Array.from(
      new Set(
        items
          .map((format) => cleanString(format.ext)?.toLowerCase())
          .filter((ext): ext is string => Boolean(ext)),
      ),
    ).sort();

  const extractor =
    cleanString(raw.extractor_key) ?? cleanString(raw.extractor) ?? "generic";
  const thumbnail = cleanString(raw.thumbnail);
  const duration =
    typeof raw.duration === "number" && Number.isFinite(raw.duration)
      ? Math.max(0, Math.round(raw.duration))
      : undefined;

  return {
    source: sourceLabel(extractor),
    extractor,
    title: cleanString(raw.title) ?? "Untitled media",
    uploader:
      cleanString(raw.uploader) ?? cleanString(raw.channel) ?? cleanString(raw.creator),
    thumbnail: thumbnail && /^https?:\/\//i.test(thumbnail) ? thumbnail : undefined,
    duration,
    hasVideo: videoFormats.length > 0,
    hasAudio: audioFormats.length > 0,
    resolutions,
    videoContainers: containers(videoFormats),
    audioContainers: containers(audioFormats),
    hasImage: imageFormats.length > 0,
    imageContainers: containers(imageFormats),
  };
}

export async function inspectMedia(
  url: string,
): Promise<MediaCapabilities> {
  const args = [
    "--ignore-config",
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    "--no-colors",
    "--socket-timeout",
    "20",
    "--",
    url,
  ];

  let stdout: string;
  try {
    ({ stdout } = await collectProcess("yt-dlp", args));
  } catch (error) {
    if (xPostId(url)) {
      try {
        const items = await getXMedia(url);
        if (items.length) return xCapabilities(items);
      } catch { /* The original yt-dlp error is more useful. */ }
    }
    throw error;
  }

  let metadata: YtDlpMetadata;
  try {
    metadata = JSON.parse(stdout) as YtDlpMetadata;
  } catch {
    throw new Error("yt-dlp returned metadata in an unexpected format.");
  }

  if (Array.isArray(metadata.entries) && metadata.entries.length > 0) {
    const items = metadata.entries
      .filter((entry): entry is YtDlpMetadata => Boolean(entry && typeof entry === "object"))
      .flatMap((entry) => {
        try { return [normalizeMetadata(entry)]; } catch { return []; }
      });
    if (items.length) return { ...items[0], ...(items.length > 1 ? { items } : {}) };
  }

  try {
    return normalizeMetadata(metadata);
  } catch (error) {
    if (xPostId(url)) {
      try {
        const items = await getXMedia(url);
        if (items.length) return xCapabilities(items);
      } catch { /* Preserve the original error. */ }
    }
    throw error;
  }
}

function collectProcess(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let exceededLimit = false;
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Media inspection timed out. Please try again."));
    }, INSPECTION_TIMEOUT_MS);
    timer.unref();

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > MAX_METADATA_BYTES) {
        exceededLimit = true;
        child.kill("SIGKILL");
        return;
      }
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_ERROR_BYTES);
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        finish(new Error("yt-dlp was not found in PATH."));
      } else {
        finish(new Error(`Unable to start yt-dlp: ${error.message}`));
      }
    });

    child.on("close", (code) => {
      if (exceededLimit) {
        finish(new Error("The media metadata was too large to inspect safely."));
      } else if (code !== 0) {
        finish(classifyYtDlpError(stderr));
      } else {
        finish();
      }
    });
  });
}
