export interface MediaCapabilities {
  source: string;
  extractor: string;
  title: string;
  uploader?: string;
  thumbnail?: string;
  duration?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  resolutions: number[];
  videoContainers: string[];
  audioContainers: string[];
  /** True when the media exposes still-image formats (e.g. photos). */
  hasImage?: boolean;
  /** Image extensions exposed by the extractor, e.g. ["jpg", "webp"]. */
  imageContainers?: string[];
  items?: MediaCapabilities[];
}

export type DownloadType = "video" | "audio" | "image";
export type DownloadDestination = "download" | "server";

export type JobErrorKind =
  /** No session was supplied / available, or the site rejected the login. */
  | "auth"
  /** A stored session was supplied but the site reports it expired. */
  | "session-expired"
  /** the site requires a human login challenge/checkpoint — never bypassed. */
  | "challenge"
  /** the site is throttling this client (HTTP 429 / too many requests). */
  | "rate-limit"
  /** The request never reached the site (connection/DNS/TLS/timeout). */
  | "network"
  /** Deleted, expired, private, or region-locked media. */
  | "unavailable"
  /** URL/extractor not handled. */
  | "unsupported"
  /** Filesystem, ffmpeg, or empty-output failure. */
  | "output"
  | "unknown";
export type VideoFormat = "mp4" | "mkv" | "webm";
export type AudioFormat = "m4a" | "mp3" | "opus";
/** Images keep their original container (e.g. .jpg) with no re-encoding. */
export type ImageFormat = "original";
export type DownloadFormat = VideoFormat | AudioFormat | ImageFormat;
export type DownloadQuality = "best" | number;
export type JobStatus =
  | "queued"
  | "downloading"
  | "processing"
  | "complete"
  | "error";

export interface CreateJobInput {
  url: string;
  type: DownloadType;
  quality?: DownloadQuality;
  format: DownloadFormat;
  destination: DownloadDestination;
  itemIndex?: number;
}

export interface DownloadJob {
  id: string;
  status: JobStatus;
  progress?: number;
  speed?: string;
  eta?: string;
  filename?: string;
  savedPath?: string;
  fileUrl?: string;
  error?: string;
  /** Machine-readable failure category, set when status === "error". */
  errorKind?: JobErrorKind;
  details?: string;
  destination: DownloadDestination;
  createdAt: string;
  updatedAt: string;
}
