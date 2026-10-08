export type PostRatio = "9:16" | "1:1" | "4:5" | "16:9";
export type PostTheme = "dark" | "light";
export type PostAnimation = "fade" | "static";
export type PostOutput = "png" | "mp4";

export interface PostOptions {
  ratio: PostRatio;
  theme: PostTheme;
  background: string;
  animation: PostAnimation;
  seconds: 3 | 5 | 10;
  showDate: boolean;
  showMetrics: boolean;
  output: PostOutput;
}

export const POST_SIZES: Record<PostRatio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "16:9": { width: 1920, height: 1080 },
};

export const POST_BACKGROUNDS: Record<string, string> = {
  midnight: "linear-gradient(145deg, #101522, #101b30 50%, #2c3559)",
  indigo: "linear-gradient(145deg, #323a82, #856eaf 55%, #b48cb0)",
  sunset: "linear-gradient(145deg, #5e3154, #d47770 55%, #f8b989)",
  sage: "linear-gradient(145deg, #183b37, #4b7769 55%, #b5b79a)",
};

export function parsePostOptions(value: unknown): PostOptions {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const ratio = ["9:16", "1:1", "4:5", "16:9"].includes(String(raw.ratio))
    ? raw.ratio as PostRatio : "9:16";
  const background = typeof raw.background === "string" &&
    (raw.background in POST_BACKGROUNDS || /^#[0-9a-fA-F]{6}$/.test(raw.background))
    ? raw.background : "midnight";
  return {
    ratio,
    theme: raw.theme === "light" ? "light" : "dark",
    background,
    animation: raw.animation === "static" ? "static" : "fade",
    seconds: raw.seconds === 3 || raw.seconds === 10 ? raw.seconds : 5,
    showDate: raw.showDate !== false,
    showMetrics: raw.showMetrics !== false,
    output: raw.output === "png" ? "png" : "mp4",
  };
}
