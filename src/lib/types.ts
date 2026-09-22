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
}

export type DownloadType = "video" | "audio";
export type DownloadDestination = "download" | "server";
export type VideoFormat = "mp4" | "mkv" | "webm";
export type AudioFormat = "m4a" | "mp3" | "opus";
export type DownloadFormat = VideoFormat | AudioFormat;
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
  details?: string;
  destination: DownloadDestination;
  createdAt: string;
  updatedAt: string;
}
