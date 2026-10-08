import { spawn } from "node:child_process";

import type { MediaCapabilities } from "@/lib/types";

interface XFormat { url?: unknown; container?: unknown }
interface XVideo {
  type?: unknown;
  url?: unknown;
  thumbnail_url?: unknown;
  duration?: unknown;
  formats?: unknown;
}
interface XTweet {
  text?: unknown;
  translation?: { text?: unknown };
  author?: { screen_name?: unknown; name?: unknown };
  media?: { videos?: unknown };
}

export interface XMediaItem {
  url: string;
  title: string;
  id: string;
  index: number;
  resolutions: number[];
  variants: { url: string; height: number }[];
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  hasAudio: boolean;
}

export function xPostId(url: string): string | undefined {
  const parsed = new URL(url);
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(parsed.hostname.toLowerCase())) return;
  return parsed.pathname.match(/\/(?:status|statuses)\/(\d+)/)?.[1];
}

function xVideoUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === "video.twimg.com" && url.pathname.endsWith(".mp4")) return value;
  } catch { /* Ignore malformed API data. */ }
}

async function hasAudio(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", url], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString().slice(0, 200); });
    child.on("error", () => resolve(false));
    child.on("close", () => { clearTimeout(timer); resolve(output.split(/\s+/).includes("audio")); });
  });
}

export async function getXMedia(url: string): Promise<XMediaItem[]> {
  const id = xPostId(url);
  if (!id) return [];

  // Only a numeric post ID is sent to this fixed API host. An API node can
  // occasionally return a transient 404, so try the documented v2 endpoint
  // before the two legacy post paths.
  const parsed = new URL(url);
  const handle = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\//)?.[1] ?? "i";
  let tweet: XTweet | undefined;
  const endpoints = [
    `https://api.fxtwitter.com/2/status/${id}?lang=en`,
    `https://api.fxtwitter.com/${handle}/status/${id}/en`,
    `https://api.fxtwitter.com/i/status/${id}/en`,
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (!response.ok) continue;
      const data = await response.json() as { code?: number; tweet?: XTweet; status?: XTweet };
      if (data.code !== 200) continue;
      const candidate = data.status ?? data.tweet;
      if (Array.isArray(candidate?.media?.videos) && candidate.media.videos.length) {
        tweet = candidate;
        break;
      }
    } catch { /* Try the alternate post path. */ }
  }
  if (!tweet) return [];
  const videos = tweet.media!.videos as XVideo[];
  const titleText = typeof tweet.translation?.text === "string" && tweet.translation.text.trim()
    ? tweet.translation.text
    : tweet.text;
  const title = typeof titleText === "string" && titleText.trim()
    ? titleText.replace(/\s+/g, " ").trim().slice(0, 140)
    : `X post ${id}`;
  const uploader = typeof tweet.author?.name === "string" ? tweet.author.name : undefined;

  return Promise.all(videos.map(async (video, index) => {
    const formats = Array.isArray(video.formats) ? video.formats as XFormat[] : [];
    const variants = formats.flatMap((format) => {
      if (format.container !== "mp4") return [];
      const mediaUrl = xVideoUrl(format.url);
      const match = mediaUrl && new URL(mediaUrl).pathname.match(/\/(\d+)x(\d+)\//);
      return mediaUrl && match ? [{ url: mediaUrl, height: Number(match[2]) }] : [];
    }).sort((a, b) => b.height - a.height);
    const thumbnail = typeof video.thumbnail_url === "string" && /^https:\/\/pbs\.twimg\.com\//.test(video.thumbnail_url)
      ? video.thumbnail_url : undefined;
    return {
      url,
      title: videos.length > 1 ? `${title} #${index + 1}` : title,
      id,
      index: index + 1,
      resolutions: [...new Set(variants.map((variant) => variant.height))],
      variants,
      thumbnail,
      duration: typeof video.duration === "number" ? Math.round(video.duration) : undefined,
      uploader,
      hasAudio: variants[0] ? await hasAudio(variants[0].url) : false,
    };
  })).then((items) => items.filter((item) => item.variants.length > 0));
}

export function xCapabilities(items: XMediaItem[]): MediaCapabilities {
  const normalized = items.map((item): MediaCapabilities => ({
    source: "X",
    extractor: "twitter",
    title: item.title,
    uploader: item.uploader,
    thumbnail: item.thumbnail,
    duration: item.duration,
    hasVideo: true,
    hasAudio: item.hasAudio,
    resolutions: item.resolutions,
    videoContainers: ["mp4"],
    audioContainers: item.hasAudio ? ["m4a"] : [],
  }));
  return { ...normalized[0], ...(normalized.length > 1 ? { items: normalized } : {}) };
}
