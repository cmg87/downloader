"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";

import type { DownloadDestination, DownloadJob } from "@/lib/types";
import type { XPost } from "@/lib/x-post";
import { POST_SIZES, type PostOptions } from "@/lib/post-options";

const backgrounds = [
  { id: "midnight", label: "Midnight" },
  { id: "indigo", label: "Indigo" },
  { id: "sunset", label: "Sunset" },
  { id: "sage", label: "Sage" },
];

const initialOptions: PostOptions = {
  ratio: "9:16",
  theme: "dark",
  background: "midnight",
  animation: "fade",
  seconds: 5,
  showDate: true,
  showMetrics: true,
  output: "mp4",
};

export function CopyXPost() {
  const [url, setUrl] = useState("");
  const [post, setPost] = useState<XPost>();
  const [options, setOptions] = useState<PostOptions>(initialOptions);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<{ key: string; src?: string; error?: string }>();
  const [job, setJob] = useState<DownloadJob>();
  const [jobError, setJobError] = useState<string>();
  const downloaded = useRef<string | undefined>(undefined);
  const jobActive = Boolean(job && ["queued", "downloading", "processing"].includes(job.status));
  const previewUrl = post ? `/api/x-post/preview?${new URLSearchParams({
    id: post.id,
    ratio: options.ratio,
    theme: options.theme,
    background: options.background,
    output: options.output,
    showDate: String(options.showDate),
    showMetrics: String(options.showMetrics),
  })}` : undefined;

  useEffect(() => {
    if (!previewUrl) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetch(previewUrl, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json() as { error?: string };
          throw new Error(body.error ?? "Could not preview this post.");
        }
        return response.blob();
      })
      .then((blob) => {
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setPreview({ key: previewUrl, src: objectUrl });
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setPreview({ key: previewUrl, error: reason instanceof Error ? reason.message : "Could not preview this post." });
      });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [previewUrl]);

  useEffect(() => {
    if (!job || !jobActive) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
        const data = await response.json() as DownloadJob & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not check export progress.");
        if (!cancelled) setJob(data);
      } catch (reason) {
        if (!cancelled) setJobError(reason instanceof Error ? reason.message : "Could not check export progress.");
      }
    }, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job, jobActive]);

  useEffect(() => {
    if (job?.status !== "complete" || job.destination !== "download" || !job.fileUrl || downloaded.current === job.id) return;
    downloaded.current = job.id;
    const anchor = document.createElement("a");
    anchor.href = job.fileUrl;
    anchor.download = job.filename ?? "x-post";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [job]);

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || inspecting) return;
    setInspecting(true);
    setError(undefined);
    setPost(undefined);
    setJob(undefined);
    setJobError(undefined);
    try {
      const response = await fetch("/api/x-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json() as XPost & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not read this post.");
      setPost(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read this post.");
    } finally {
      setInspecting(false);
    }
  }

  async function exportPost(destination: DownloadDestination) {
    if (!post || jobActive) return;
    setJob(undefined);
    setJobError(undefined);
    downloaded.current = undefined;
    try {
      const response = await fetch("/api/x-post/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: post.url, options, destination }),
      });
      const data = await response.json() as DownloadJob & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not start the export.");
      setJob(data);
    } catch (reason) {
      setJobError(reason instanceof Error ? reason.message : "Could not start the export.");
    }
  }

  const dimensions = POST_SIZES[options.ratio];
  const hasVideo = Boolean(post && [...post.media, ...(post.quote?.media ?? [])].some((item) => item.kind === "video" && item.videoUrl));
  const activePreview = preview?.key === previewUrl ? preview : undefined;

  return (
    <div className="copy-post-app">
      <header className="brand-block">
        <div className="brand-mark" aria-hidden="true"><Image src="/icons/app-mark.png" alt="" width={48} height={48} /></div>
        <div><p className="eyebrow">Keep the whole moment</p><h1>Copy X post</h1></div>
      </header>

      <form className="url-form" onSubmit={inspect}>
        <label className="sr-only" htmlFor="copy-x-url">X post URL</label>
        <input id="copy-x-url" type="url" inputMode="url" placeholder="Paste an X post link…" value={url}
          onChange={(event) => { setUrl(event.target.value); setPost(undefined); setError(undefined); setJob(undefined); }}
          disabled={inspecting} required />
        <button className="inspect-button" type="submit" disabled={inspecting || !url.trim()} aria-label="Inspect X post">
          {inspecting ? <span className="spinner" /> : <Image src="/icons/inspect.png" alt="" width={26} height={26} />}
        </button>
      </form>

      {error && <p className="copy-error" role="alert">{error}</p>}

      {post && <div className="copy-layout">
        <div className="copy-controls">
          <div className="copy-post-identity">
            {post.avatarUrl && <Image src={post.avatarUrl} alt="" width={44} height={44} unoptimized />}
            <div><strong>{post.name}</strong><span>@{post.handle}</span></div>
          </div>
          <p className="copy-post-excerpt">{post.text || "Media post"}</p>

          <ChoiceRow label="Export as">
            {(["mp4", "png"] as const).map((output) => <Option key={output} active={options.output === output} onClick={() => setOptions({ ...options, output })}>{output.toUpperCase()}</Option>)}
          </ChoiceRow>
          <ChoiceRow label="Canvas">
            {(["9:16", "4:5", "1:1", "16:9"] as const).map((ratio) => <Option key={ratio} active={options.ratio === ratio} onClick={() => setOptions({ ...options, ratio })}>{ratio}</Option>)}
          </ChoiceRow>
          <ChoiceRow label="Post style">
            {(["dark", "light"] as const).map((theme) => <Option key={theme} active={options.theme === theme} onClick={() => setOptions({ ...options, theme })}>{theme === "dark" ? "Dark" : "Light"}</Option>)}
          </ChoiceRow>
          <ChoiceRow label="Background">
            {backgrounds.map((item) => <Option key={item.id} active={options.background === item.id} onClick={() => setOptions({ ...options, background: item.id })}>{item.label}</Option>)}
            <label className="copy-color-label">Custom <input aria-label="Custom background color" type="color" value={options.background.startsWith("#") ? options.background : "#202a40"} onChange={(event) => setOptions({ ...options, background: event.target.value })} /></label>
          </ChoiceRow>
          <ChoiceRow label="Show on post">
            <Option active={options.showDate} onClick={() => setOptions({ ...options, showDate: !options.showDate })}>Date</Option>
            <Option active={options.showMetrics} onClick={() => setOptions({ ...options, showMetrics: !options.showMetrics })}>Metrics</Option>
          </ChoiceRow>
          {options.output === "mp4" && <>
            {hasVideo ? <p className="copy-hint">The attached video plays in the card, with its original audio and duration.</p>
              : <ChoiceRow label="Clip length">
                  {([3, 5, 10] as const).map((seconds) => <Option key={seconds} active={options.seconds === seconds} onClick={() => setOptions({ ...options, seconds })}>{seconds}s</Option>)}
                </ChoiceRow>}
            <ChoiceRow label="Motion">
              <Option active={options.animation === "fade"} onClick={() => setOptions({ ...options, animation: "fade" })}>Fade in</Option>
              <Option active={options.animation === "static"} onClick={() => setOptions({ ...options, animation: "static" })}>Static</Option>
            </ChoiceRow>
          </>}

          <div className="action-grid copy-actions">
            <button className="action-button secondary-action" type="button" disabled={jobActive} onClick={() => exportPost("server")}><span><strong>Save</strong><small>This PC</small></span></button>
            <button className="action-button primary-action" type="button" disabled={jobActive} onClick={() => exportPost("download")}><span><strong>Download</strong><small>This device</small></span></button>
          </div>
          {jobError && <p className="copy-error" role="alert">{jobError}</p>}
          {job && <div className="copy-job" role="status" aria-live="polite">
            <strong>{job.status === "complete" ? "Ready" : job.status === "error" ? "Export failed" : "Composing post"}</strong>
            {job.status === "error" && <p>{job.error}</p>}
            {job.status === "complete" && <p>{job.destination === "server" ? job.savedPath : job.filename}</p>}
            {job.status === "complete" && job.fileUrl && <a href={job.fileUrl} download>Download again</a>}
            {jobActive && <div className="progress-track"><span style={{ width: `${job.progress ?? 4}%` }} /></div>}
          </div>}
        </div>

        <div className="copy-preview-panel">
          <div className="copy-preview-heading"><span>Preview</span><span>{dimensions.width} × {dimensions.height}</span></div>
          <div className="copy-preview-stage">
            {activePreview?.src ? <Image src={activePreview.src} alt={`Preview of ${post.name}'s X post`} width={dimensions.width} height={dimensions.height} unoptimized />
              : <div className="copy-preview-loading">{activePreview?.error ?? "Rendering preview…"}</div>}
          </div>
          <p className="copy-preview-note">Public X post data is retrieved through FxTwitter. The final file is composed on this PC.</p>
        </div>
      </div>}
    </div>
  );
}

function ChoiceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="copy-choice-group"><span>{label}</span><div className="choice-list">{children}</div></div>;
}

function Option({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={`choice-button ${active ? "active" : ""}`} aria-pressed={active} onClick={onClick}>{children}</button>;
}
