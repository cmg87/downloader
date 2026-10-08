import { xPostId } from "@/lib/x-fallback";

export interface XPostMedia {
  kind: "photo" | "video";
  imageUrl: string;
  videoUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
}

export interface XPostQuote {
  name: string;
  handle: string;
  text: string;
  avatarUrl?: string;
  media: XPostMedia[];
}

export interface XPost {
  id: string;
  url: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  text: string;
  createdAt?: string;
  replyingTo?: string;
  quote?: XPostQuote;
  replies?: number;
  reposts?: number;
  likes?: number;
  views?: number;
  media: XPostMedia[];
}

type RawObject = Record<string, unknown>;

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RESPONSE_CHARS = 2_000_000;
const cache = new Map<string, { post: XPost; expires: number }>();

function object(value: unknown): RawObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RawObject : undefined;
}

function str(value: unknown, max = 6000): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max) : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value) : undefined;
}

function cdnUrl(value: unknown, host: "pbs.twimg.com" | "video.twimg.com"): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === host) return url.toString();
  } catch { /* Invalid media URL from upstream. */ }
}

function normalizeMedia(value: unknown): XPostMedia[] {
  const media = object(value);
  const all = Array.isArray(media?.all) && media.all.length > 0
    ? media.all
    : [
        ...(Array.isArray(media?.photos) ? media.photos : []),
        ...(Array.isArray(media?.videos) ? media.videos : []),
      ];
  return all.flatMap((item): XPostMedia[] => {
    const entry = object(item);
    if (!entry) return [];
    const dimensions = { width: count(entry.width), height: count(entry.height) };
    const isVideo = entry.type === "video" || entry.type === "gif" || entry.type === "animated_gif";
    if (isVideo) {
      const imageUrl = cdnUrl(entry.thumbnail_url, "pbs.twimg.com");
      const variants = Array.isArray(entry.formats) ? entry.formats : [];
      const mp4s = variants.flatMap((format) => {
        const variant = object(format);
        const url = cdnUrl(variant?.url, "video.twimg.com");
        return variant?.container === "mp4" && url ? [{ url, bitrate: count(variant.bitrate) ?? 0 }] : [];
      }).sort((a, b) => b.bitrate - a.bitrate);
      const videoUrl = mp4s[0]?.url ?? cdnUrl(entry.url, "video.twimg.com");
      if (!imageUrl && !videoUrl) return [];
      return [{ kind: "video", imageUrl: imageUrl ?? "", videoUrl, duration: count(entry.duration), ...dimensions }];
    }
    const imageUrl = cdnUrl(entry.url, "pbs.twimg.com");
    return imageUrl ? [{ kind: "photo", imageUrl, ...dimensions }] : [];
  }).slice(0, 4);
}

function normalizeQuote(value: unknown): XPostQuote | undefined {
  const raw = object(value);
  const author = object(raw?.author);
  const handle = str(author?.screen_name, 40);
  const translation = object(raw?.translation);
  const media = normalizeMedia(raw?.media);
  const text = str(translation?.text) ?? str(raw?.text) ?? "";
  if (!raw || !handle || (!text && media.length === 0)) return;
  return {
    name: str(author?.name, 100) ?? handle,
    handle,
    text,
    avatarUrl: cdnUrl(author?.avatar_url, "pbs.twimg.com"),
    media,
  };
}

function normalizePost(id: string, raw: RawObject): XPost {
  const author = object(raw.author);
  const translation = object(raw.translation);
  const handle = str(author?.screen_name, 40) ?? "unknown";

  const reply = object(raw.replying_to);
  const replyHandle = str(reply?.screen_name, 40) ?? str(reply?.user, 40);
  const created = str(raw.created_at, 100);
  const createdAt = created && !Number.isNaN(Date.parse(created))
    ? new Date(created).toISOString() : undefined;

  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    name: str(author?.name, 100) ?? handle,
    handle,
    avatarUrl: cdnUrl(author?.avatar_url, "pbs.twimg.com"),
    text: str(translation?.text) ?? str(raw.text) ?? "",
    createdAt,
    replyingTo: replyHandle,
    quote: normalizeQuote(raw.quote ?? raw.quoted_status),
    replies: count(raw.replies),
    reposts: count(raw.retweets),
    likes: count(raw.likes),
    views: count(raw.views),
    media: normalizeMedia(raw.media),
  };
}

export async function getXPost(url: string): Promise<XPost> {
  const id = xPostId(url);
  if (!id) throw new Error("Paste a link to an X post, such as https://x.com/user/status/123.");
  const cached = cache.get(id);
  if (cached && cached.expires > Date.now()) return cached.post;

  const match = new URL(url).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\//);
  const handle = match?.[1] ?? "i";
  let raw: RawObject | undefined;
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
        redirect: "error",
      });
      if (!response.ok || Number(response.headers.get("content-length")) > MAX_RESPONSE_CHARS) continue;
      const body = await response.text();
      if (body.length > MAX_RESPONSE_CHARS) continue;
      const data = JSON.parse(body) as RawObject;
      if (data.code !== 200) continue;
      raw = object(data.status ?? data.tweet);
      if (raw) break;
    } catch { /* FxTwitter can intermittently fail on one endpoint. */ }
  }
  if (!raw) throw new Error("Could not read this public X post. It may be private, deleted, or temporarily unavailable.");

  const post = normalizePost(id, raw);
  if (!post.text && post.media.length === 0 && !post.quote) {
    throw new Error("This X post has no text or media to copy.");
  }
  cache.set(id, { post, expires: Date.now() + CACHE_TTL_MS });
  return post;
}
