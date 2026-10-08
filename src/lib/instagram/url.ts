import type { InstagramTarget } from "@/lib/instagram/types";

export function parseInstagramTarget(value: unknown): InstagramTarget {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) {
    throw new Error("Paste an Instagram link or @username.");
  }
  const raw = value.trim();
  if (/^@[a-z\d._]{1,30}$/i.test(raw)) return { kind: "stories", username: raw.slice(1) };
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Paste a complete Instagram link or @username for stories."); }
  if (!['http:', 'https:'].includes(url.protocol) || !['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase()) || url.username || url.password) {
    throw new Error("Use a link from instagram.com.");
  }
  const path = decodeURIComponent(url.pathname).split("/").filter(Boolean);
  if (["p", "reel", "reels", "tv"].includes(path[0]?.toLowerCase()) && /^[a-z\d_-]+$/i.test(path[1] ?? "") && path.length === 2) {
    return { kind: "post", shortcode: path[1] };
  }
  if (path[0]?.toLowerCase() === "stories") {
    if (path[1]?.toLowerCase() === "highlights") throw new Error("Use a current story or profile link. Highlights are not supported.");
    if (/^[a-z\d._]{1,30}$/i.test(path[1] ?? "") && path.length <= 3 && (!path[2] || /^\d+$/.test(path[2]))) {
      return { kind: "stories", username: path[1], mediaId: path[2] };
    }
  }
  if (path.length === 1 && /^[a-z\d._]{1,30}$/i.test(path[0]) && !["accounts", "explore", "direct", "stories", "reels"].includes(path[0].toLowerCase())) {
    return { kind: "stories", username: path[0] };
  }
  throw new Error("Use a post, reel, story, or profile link.");
}
