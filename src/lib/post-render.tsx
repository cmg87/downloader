/* eslint-disable @next/next/no-img-element -- ImageResponse needs raw image nodes for the exported PNG. */
import { ImageResponse } from "next/og";

import type { XPost, XPostMedia } from "@/lib/x-post";
import { POST_BACKGROUNDS, POST_SIZES, type PostOptions } from "@/lib/post-options";

export interface VideoSlot { x: number; y: number; width: number; height: number }

function compact(value?: number): string {
  if (value === undefined) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

async function imageData(url?: string): Promise<string | undefined> {
  if (!url) return;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store", redirect: "error" });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(type.split(";")[0]) ||
        Number(response.headers.get("content-length")) > 8_000_000) return;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 8_000_000) return;
    return `data:${type.split(";")[0]};base64,${buffer.toString("base64")}`;
  } catch { return; }
}

function estimateLines(text: string, charsPerLine: number): number {
  return text.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

function selectMedia(items: XPostMedia[], options: PostOptions): XPostMedia | undefined {
  return options.output === "mp4"
    ? items.find((item) => item.kind === "video" && item.videoUrl) ?? items[0]
    : items[0];
}

function MediaPreview({ media, src, width, height, count, dark }: {
  media: XPostMedia;
  src?: string;
  width: number;
  height: number;
  count: number;
  dark: boolean;
}) {
  return <div style={{ width, height, position: "relative", background: dark ? "#0b1018" : "#e9eef3", display: "flex", alignItems: "center", justifyContent: "center" }}>
    {src ? <img src={src} alt="" width={width} height={height} style={{ objectFit: "contain" }} /> : <span style={{ color: dark ? "#9ca6b5" : "#626b78", fontSize: 24 }}>Media preview unavailable</span>}
    {media.kind === "video" && <span style={{ position: "absolute", width: 72, height: 72, borderRadius: 36, background: "rgba(0,0,0,.7)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>PLAY</span>}
    {count > 1 && <span style={{ position: "absolute", bottom: 16, right: 16, background: "rgba(0,0,0,.7)", color: "white", padding: "7px 12px", borderRadius: 10, fontSize: 18 }}>+{count - 1} media</span>}
  </div>;
}

export async function renderPostImage(post: XPost, options: PostOptions): Promise<{
  png: Buffer;
  slot?: VideoSlot;
  video?: XPostMedia;
  width: number;
  height: number;
}> {
  const { width, height } = POST_SIZES[options.ratio];
  const landscape = options.ratio === "16:9";
  const cardWidth = landscape ? 1120 : 900;
  const pad = 44;
  const innerWidth = cardWidth - pad * 2;
  const media = selectMedia(post.media, options);
  const quoteMedia = selectMedia(post.quote?.media ?? [], options);
  const video = options.output === "mp4"
    ? [media, quoteMedia].find((item) => item?.kind === "video" && item.videoUrl)
    : undefined;
  const [avatar, mediaImage, quoteAvatar, quoteMediaImage] = await Promise.all([
    imageData(post.avatarUrl),
    imageData(media?.imageUrl),
    imageData(post.quote?.avatarUrl),
    imageData(quoteMedia?.imageUrl),
  ]);
  const text = post.text.replace(/\n{3,}/g, "\n\n");
  let fontSize = landscape ? 34 : 36;
  if (text.length > 360) fontSize = 30;
  if (text.length > 700) fontSize = 25;
  if (text.length > 1200) fontSize = 21;
  const charsPerLine = Math.max(20, Math.floor(innerWidth / (fontSize * 0.54)));
  const textHeight = Math.max(fontSize * 1.35, estimateLines(text, charsPerLine) * fontSize * 1.33);
  const replyHeight = post.replyingTo ? 38 : 0;
  const quoteText = post.quote?.text.replace(/\n{3,}/g, "\n\n") ?? "";
  const quoteTextHeight = quoteText ? estimateLines(quoteText, Math.floor((innerWidth - 48) / (23 * 0.54))) * 29 : 0;
  const quoteBodyHeight = post.quote ? 18 + 44 + (quoteText ? 6 + quoteTextHeight : 0) + 18 : 0;
  const preferredMediaHeight = media ? (text.length > 700 ? 250 : landscape ? 330 : height < 1200 ? 300 : 430) : 0;
  const preferredQuoteMediaHeight = quoteMedia
    ? Math.min(quoteMedia.width && quoteMedia.height ? (innerWidth - 4) * quoteMedia.height / quoteMedia.width : 430, landscape ? 420 : 720)
    : 0;
  const dateHeight = options.showDate && post.createdAt ? 40 : 0;
  const metricsHeight = options.showMetrics ? 54 : 0;
  const gaps = 28 + (post.quote ? 22 : 0) + (media ? 24 : 0);
  const fixedHeight = pad * 2 + 76 + replyHeight + textHeight + quoteBodyHeight + (post.quote ? 4 : 0) + dateHeight + metricsHeight + gaps;
  const availableMediaHeight = height - 72 - Math.ceil(fixedHeight);
  const preferredHeight = preferredMediaHeight + preferredQuoteMediaHeight;
  const mediaScale = preferredHeight > 0 ? Math.min(1, availableMediaHeight / preferredHeight) : 1;
  const mediaHeight = Math.floor(preferredMediaHeight * mediaScale);
  const quoteMediaHeight = Math.floor(preferredQuoteMediaHeight * mediaScale);
  const quoteHeight = post.quote ? quoteBodyHeight + quoteMediaHeight + 4 : 0;
  const cardHeight = Math.ceil(fixedHeight + mediaHeight + quoteMediaHeight);
  if (cardHeight > height - 72 || (media && mediaHeight < 120) || (quoteMedia && quoteMediaHeight < 120)) {
    throw new Error("This post is too long for the selected canvas. Try a taller aspect ratio or hide metrics/date.");
  }
  const cardX = Math.round((width - cardWidth) / 2);
  const cardY = Math.round((height - cardHeight) / 2);
  const headerY = pad;
  const replyY = headerY + 82;
  const textY = replyY + replyHeight + 8;
  const mediaY = textY + textHeight + 18;
  const quoteY = mediaY + (media ? mediaHeight + 14 : 0);
  const dateY = mediaY + mediaHeight + quoteHeight + (post.quote ? 14 : 0) + (media ? 22 : 0);
  const metricsY = dateY + dateHeight + 14;
  const slot = video
    ? video === media
      ? { x: cardX + pad, y: cardY + mediaY, width: innerWidth, height: mediaHeight }
      : { x: cardX + pad + 2, y: cardY + quoteY + 2 + quoteBodyHeight, width: innerWidth - 4, height: quoteMediaHeight }
    : undefined;
  const dark = options.theme === "dark";
  const ink = dark ? "#f6f8fa" : "#171a20";
  const muted = dark ? "#9ca6b5" : "#626b78";
  const cardColor = dark ? "#151b24" : "#ffffff";
  const line = dark ? "#34404f" : "#e0e5eb";
  const background = POST_BACKGROUNDS[options.background] ?? options.background;
  const timestamp = post.createdAt
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(post.createdAt)) + " UTC"
    : undefined;

  const image = new ImageResponse(
    <div style={{ width, height, display: "flex", position: "relative", background, fontFamily: "Arial, sans-serif" }}>
      <div style={{ position: "absolute", left: cardX, top: cardY, width: cardWidth, height: cardHeight, display: "flex", background: cardColor, borderRadius: 34, boxShadow: "0 28px 75px rgba(0,0,0,.28)" }}>
        <div style={{ position: "absolute", left: pad, top: headerY, display: "flex", alignItems: "center", width: innerWidth, height: 72 }}>
          {avatar ? <img src={avatar} alt="" width={70} height={70} style={{ borderRadius: 35, objectFit: "cover" }} />
            : <div style={{ width: 70, height: 70, borderRadius: 35, background: dark ? "#34404f" : "#e0e5eb", display: "flex", alignItems: "center", justifyContent: "center", color: ink, fontSize: 30 }}>{post.name[0]?.toUpperCase() ?? "X"}</div>}
          <div style={{ marginLeft: 18, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <span style={{ color: ink, fontWeight: 700, fontSize: 31 }}>{post.name}</span>
            <span style={{ color: muted, fontSize: 24 }}>@{post.handle}</span>
          </div>
          <span style={{ marginLeft: "auto", color: ink, fontSize: 38, fontWeight: 700 }}>X</span>
        </div>
        {post.replyingTo && <div style={{ position: "absolute", left: pad, top: replyY, color: muted, fontSize: 22, display: "flex" }}>Replying to @{post.replyingTo}</div>}
        <div style={{ position: "absolute", left: pad, top: textY, width: innerWidth, height: textHeight, display: "flex", color: ink, fontSize, lineHeight: 1.33, whiteSpace: "pre-wrap", overflow: "hidden" }}>{text}</div>
        {post.quote && <div style={{ position: "absolute", left: pad, top: quoteY, width: innerWidth, height: quoteHeight, border: `2px solid ${line}`, borderRadius: 22, display: "flex", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 22, top: 18, width: innerWidth - 48, height: 44, display: "flex", alignItems: "center", overflow: "hidden" }}>
            {quoteAvatar && <img src={quoteAvatar} alt="" width={40} height={40} style={{ borderRadius: 20, objectFit: "cover", marginRight: 12 }} />}
            <span style={{ color: ink, fontSize: 24, fontWeight: 700 }}>{post.quote.name} <span style={{ color: muted, fontWeight: 400 }}>@{post.quote.handle}</span></span>
          </div>
          {quoteText && <div style={{ position: "absolute", left: 22, top: 68, width: innerWidth - 48, height: quoteTextHeight, display: "flex", color: ink, fontSize: 23, lineHeight: 1.25, whiteSpace: "pre-wrap" }}>{quoteText}</div>}
          {quoteMedia && <div style={{ position: "absolute", left: 0, top: quoteBodyHeight, display: "flex" }}>
            <MediaPreview media={quoteMedia} src={quoteMediaImage} width={innerWidth - 4} height={quoteMediaHeight} count={post.quote.media.length} dark={dark} />
          </div>}
        </div>}
        {media && <div style={{ position: "absolute", left: pad, top: mediaY, width: innerWidth, height: mediaHeight, borderRadius: 22, overflow: "hidden", display: "flex" }}>
          <MediaPreview media={media} src={mediaImage} width={innerWidth} height={mediaHeight} count={post.media.length} dark={dark} />
        </div>}
        {dateHeight > 0 && <div style={{ position: "absolute", left: pad, top: dateY, color: muted, fontSize: 22, display: "flex" }}>{timestamp}</div>}
        {metricsHeight > 0 && <div style={{ position: "absolute", left: pad, top: metricsY, width: innerWidth, borderTop: `2px solid ${line}`, paddingTop: 15, color: muted, fontSize: 22, display: "flex", justifyContent: "space-between" }}>
          <span>Replies {compact(post.replies)}</span><span>Reposts {compact(post.reposts)}</span><span>Likes {compact(post.likes)}</span><span>Views {compact(post.views)}</span>
        </div>}
      </div>
    </div>,
    { width, height },
  );
  return { png: Buffer.from(await image.arrayBuffer()), slot, video, width, height };
}
