"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";

import type {
  AudioFormat,
  DownloadDestination,
  DownloadFormat,
  DownloadJob,
  DownloadQuality,
  JobErrorKind,
  MediaCapabilities,
  VideoFormat,
} from "@/lib/types";

type Selection =
  | { type: "video"; quality: DownloadQuality }
  | { type: "audio"; quality?: never }
  | { type: "image"; quality?: never };

interface ApiError {
  error?: string;
  details?: string;
  errorKind?: JobErrorKind;
}

const videoFormats: VideoFormat[] = ["mp4", "mkv", "webm"];
const audioFormats: AudioFormat[] = ["m4a", "mp3", "opus"];

export function Downloader() {
  const [url, setUrl] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string>();
  const [media, setMedia] = useState<MediaCapabilities>();
  const [mediaItemIndex, setMediaItemIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>({
    type: "video",
    quality: "best",
  });
  const [format, setFormat] = useState<DownloadFormat>("mp4");
  const [job, setJob] = useState<DownloadJob>();
  const [jobRequestError, setJobRequestError] = useState<string>();
  const automaticallyDownloaded = useRef<string | undefined>(undefined);
  const jobId = job?.id;

  const jobIsActive = Boolean(
    job && ["queued", "downloading", "processing"].includes(job.status),
  );

  useEffect(() => {
    if (!jobId || !jobIsActive) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const data = (await response.json()) as DownloadJob & ApiError;
        if (!response.ok) throw new Error(data.error ?? "Could not check download progress.");
        if (!cancelled) {
          setJob(data);
          if (["queued", "downloading", "processing"].includes(data.status)) {
            timer = setTimeout(poll, 1_000);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setJobRequestError(error instanceof Error ? error.message : "Progress check failed.");
        }
      }
    };

    timer = setTimeout(poll, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, jobIsActive]);

  useEffect(() => {
    if (
      job?.status !== "complete" ||
      job.destination !== "download" ||
      !job.fileUrl ||
      automaticallyDownloaded.current === job.id
    ) {
      return;
    }

    automaticallyDownloaded.current = job.id;
    const link = document.createElement("a");
    link.href = job.fileUrl;
    link.download = job.filename ?? "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [job]);

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || inspecting) return;

    setInspecting(true);
    setInspectError(undefined);
    setJob(undefined);
    setJobRequestError(undefined);
    automaticallyDownloaded.current = undefined;

    try {
      const response = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await response.json()) as MediaCapabilities & ApiError;
      if (!response.ok) {
        throw new Error(data.error ?? "Could not inspect this URL.");
      }

      setMedia(data);
      setMediaItemIndex(0);
      if (data.hasVideo) {
        setSelection({ type: "video", quality: "best" });
        setFormat("mp4");
      } else if (data.hasImage) {
        setSelection({ type: "image" });
        setFormat("original");
      } else {
        setSelection({ type: "audio" });
        setFormat("m4a");
      }
    } catch (error) {
      setMedia(undefined);
      setInspectError(error instanceof Error ? error.message : "Could not inspect this URL.");
    } finally {
      setInspecting(false);
    }
  }

  function updateUrl(nextUrl: string) {
    setUrl(nextUrl);
    if (media) {
      setMedia(undefined);
      setJob(undefined);
      setJobRequestError(undefined);
      setInspectError(undefined);
    }
  }

  function chooseSelection(next: Selection) {
    setSelection(next);
    setJob(undefined);
    setJobRequestError(undefined);
    if (next.type === "audio") {
      setFormat("m4a");
    } else if (next.type === "image") {
      setFormat("original");
    } else if (!videoFormats.includes(format as VideoFormat)) {
      setFormat("mp4");
    }
  }

  async function createJob(destination: DownloadDestination) {
    if (!media || jobIsActive) return;

    setJob(undefined);
    setJobRequestError(undefined);
    automaticallyDownloaded.current = undefined;

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          type: selection.type,
          quality: selection.type === "video" ? selection.quality : undefined,
          format,
          destination,
          itemIndex: media.items?.length ? mediaItemIndex + 1 : undefined,
        }),
      });
      const data = (await response.json()) as DownloadJob & ApiError;
      if (!response.ok) throw new Error(data.error ?? "Could not start the download.");
      setJob(data);
    } catch (error) {
      setJobRequestError(error instanceof Error ? error.message : "Could not start the download.");
    }
  }

  const activeMedia = media?.items?.[mediaItemIndex] ?? media;
  const availableVideoFormats = activeMedia
    ? videoFormats.filter(
        (item) => item !== "webm" || activeMedia.videoContainers.includes("webm"),
      )
    : videoFormats;
  const currentFormats: DownloadFormat[] =
    selection.type === "video"
      ? availableVideoFormats
      : selection.type === "image"
        ? ["original"]
        : audioFormats;

  return (
    <div className={`app-frame ${media ? "has-result" : ""}`}>
      <header className="brand-block">
        <div className="brand-mark" aria-hidden="true">
          <Image src="/icons/app-mark.png" alt="" width={48} height={48} preload />
        </div>
        <div>
          <p className="eyebrow">Private utility</p>
          <h1>Media Downloader</h1>
        </div>
      </header>

      <form className="url-form" onSubmit={inspect}>
        <label className="sr-only" htmlFor="media-url">
          Media URL
        </label>
        <input
          id="media-url"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste a link from anywhere…"
          value={url}
          onChange={(event) => updateUrl(event.target.value)}
          disabled={inspecting}
          required
        />
        <button
          className="inspect-button"
          type="submit"
          disabled={inspecting || !url.trim()}
          aria-label={inspecting ? "Inspecting link" : "Inspect link"}
        >
          {inspecting ? (
            <Spinner />
          ) : (
            <Image src="/icons/inspect.png" alt="" width={26} height={26} />
          )}
        </button>
      </form>

      {inspectError && <ErrorNotice message={inspectError} />}

      {media && activeMedia && (
        <section className="media-card" aria-label={`Download options for ${activeMedia.title}`}>
          <MediaHeader media={activeMedia} />

          <div className="options-panel">
            {media.items && media.items.length > 1 && (
              <OptionGroup label="Item in this post">
                {media.items.map((item, index) => (
                  <ChoiceButton key={index} active={mediaItemIndex === index} onClick={() => {
                    setMediaItemIndex(index);
                    setSelection(
                      item.hasVideo
                        ? { type: "video", quality: "best" }
                        : item.hasImage
                          ? { type: "image" }
                          : { type: "audio" },
                    );
                    setFormat(item.hasVideo ? "mp4" : item.hasImage ? "original" : "m4a");
                    setJob(undefined);
                    setJobRequestError(undefined);
                  }}>
                    {item.hasVideo ? "Video" : item.hasImage ? "Image" : "Audio"} {index + 1}
                  </ChoiceButton>
                ))}
              </OptionGroup>
            )}
            <OptionGroup label="Choose what to save">
              {activeMedia.hasVideo && (
                <>
                  <ChoiceButton
                    active={selection.type === "video" && selection.quality === "best"}
                    onClick={() => chooseSelection({ type: "video", quality: "best" })}
                  >
                    Best
                  </ChoiceButton>
                  {activeMedia.resolutions.map((height) => (
                    <ChoiceButton
                      key={height}
                      active={selection.type === "video" && selection.quality === height}
                      onClick={() => chooseSelection({ type: "video", quality: height })}
                    >
                      {formatResolution(height)}
                    </ChoiceButton>
                  ))}
                </>
              )}
              {activeMedia.hasImage && (
                <ChoiceButton
                  active={selection.type === "image"}
                  onClick={() => chooseSelection({ type: "image" })}
                  wide
                >
                  <span className="choice-icon" aria-hidden="true">🖼</span>
                  Image ({activeMedia.imageContainers?.[0]?.toUpperCase() ?? "original"})
                </ChoiceButton>
              )}
              {activeMedia.hasAudio && (
                <ChoiceButton
                  active={selection.type === "audio"}
                  onClick={() => chooseSelection({ type: "audio" })}
                  wide
                >
                  <Image
                    className="choice-icon"
                    src="/icons/audio-only.png"
                    alt=""
                    width={20}
                    height={20}
                  />
                  Audio only
                </ChoiceButton>
              )}
            </OptionGroup>

            <OptionGroup label="Format">
              {currentFormats.map((item) => (
                <ChoiceButton
                  key={item}
                  active={format === item}
                  onClick={() => {
                    setFormat(item);
                    setJob(undefined);
                    setJobRequestError(undefined);
                  }}
                >
                  {item.toUpperCase()}
                </ChoiceButton>
              ))}
            </OptionGroup>

            <div className="action-grid">
              <button
                className="action-button secondary-action"
                type="button"
                onClick={() => createJob("server")}
                disabled={jobIsActive}
              >
                <Image
                  className="action-icon"
                  src="/icons/save-pc.png"
                  alt=""
                  width={30}
                  height={30}
                />
                <span>
                  <strong>Save</strong>
                  <small>This PC</small>
                </span>
              </button>
              <button
                className="action-button primary-action"
                type="button"
                onClick={() => createJob("download")}
                disabled={jobIsActive}
              >
                <Image
                  className="action-icon"
                  src="/icons/download-device.png"
                  alt=""
                  width={30}
                  height={30}
                />
                <span>
                  <strong>Download</strong>
                  <small>This device</small>
                </span>
              </button>
            </div>

            {jobRequestError && <ErrorNotice message={jobRequestError} />}
            {job && <JobProgress job={job} />}
          </div>
        </section>
      )}

    </div>
  );
}

function MediaHeader({ media }: { media: MediaCapabilities }) {
  return (
    <div className="media-header">
      <div className="thumbnail">
        {media.thumbnail ? (
          <Image
            src={media.thumbnail}
            alt=""
            fill
            sizes="(max-width: 640px) 112px, 180px"
            unoptimized
          />
        ) : (
          <div className="thumbnail-fallback" aria-hidden="true">
            <LinkIcon />
          </div>
        )}
        {media.duration !== undefined && (
          <span className="duration">{formatDuration(media.duration)}</span>
        )}
      </div>
      <div className="media-copy">
        <div className="source-line">
          <span className="source-badge">{media.source}</span>
          {media.uploader && <span className="uploader">{media.uploader}</span>}
        </div>
        <h2>{media.title}</h2>
        <p className="availability">
          {media.hasVideo
            ? media.resolutions.length > 0
              ? `${media.resolutions.length} video qualities`
              : "Video available"
            : media.hasImage
              ? "Image available"
              : "Audio"}
          {media.hasVideo && media.hasAudio ? " · audio available" : ""}
        </p>
      </div>
    </div>
  );
}

function OptionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="option-group">
      <legend>{label}</legend>
      <div className="choice-list">{children}</div>
    </fieldset>
  );
}

function ChoiceButton({
  active,
  onClick,
  wide,
  children,
}: {
  active: boolean;
  onClick: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`choice-button ${active ? "active" : ""} ${wide ? "wide" : ""}`}
      type="button"
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export function JobProgress({ job }: { job: DownloadJob }) {
  const statusLabel = {
    queued: "Getting ready",
    downloading: "Downloading",
    processing: "Processing",
    complete: job.destination === "server" ? "Saved" : "Ready",
    error: "Download failed",
  }[job.status];
  const progress = job.status === "processing" || job.status === "complete" ? 100 : job.progress ?? 0;

  return (
    <div className={`job-panel ${job.status}`} role="status" aria-live="polite">
      <div className="job-heading">
        <span className="status-icon" aria-hidden="true">
          {job.status === "complete" ? <CheckIcon /> : job.status === "error" ? "!" : <Spinner />}
        </span>
        <div>
          <strong>{statusLabel}</strong>
          {job.status === "complete" && job.filename && <p>{job.filename}</p>}
          {job.status === "error" && <p>{job.error}</p>}
        </div>
        {job.status === "downloading" && job.progress !== undefined && (
          <b>{Math.round(job.progress)}%</b>
        )}
      </div>

      {!["complete", "error"].includes(job.status) && (
        <>
          <div className="progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-meta">
            <span>{job.speed ?? (job.status === "processing" ? "Finishing file" : "Starting…")}</span>
            {job.eta && <span>ETA {job.eta}</span>}
          </div>
        </>
      )}

      {job.status === "complete" && job.destination === "server" && job.savedPath && (
        <code className="saved-path">{job.savedPath}</code>
      )}

      {job.status === "complete" && job.destination === "download" && job.fileUrl && (
        <div className="ready-row">
          <p>Your download should start automatically.</p>
          <a className="retry-link" href={job.fileUrl} download>
            Download again
          </a>
        </div>
      )}

      {job.details && job.status === "error" && (
        <details className="error-details">
          <summary>Details</summary>
          <pre>{job.details}</pre>
        </details>
      )}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="error-notice" role="alert">
      <span aria-hidden="true">!</span>
      <p>{message}</p>
    </div>
  );
}

function formatResolution(height: number): string {
  if (height === 2160) return "4K";
  if (height === 4320) return "8K";
  return `${height}p`;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
