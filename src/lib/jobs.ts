import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

import type { CreateJobInput, DownloadJob } from "@/lib/types";
import {
  buildYtDlpArgs,
  outputTemplateFor,
  sanitizeFileSegment,
} from "@/lib/download-args";
import { classifyYtDlpError, errorKindOf, YtDlpError } from "@/lib/yt-dlp";
import { getXMedia, xPostId } from "@/lib/x-fallback";
import { renderPostImage } from "@/lib/post-render";
import type { PostOptions } from "@/lib/post-options";
import { getXPost } from "@/lib/x-post";
import { instagramRequest } from "@/lib/instagram/client";
import type { InstagramJobInput } from "@/lib/instagram/types";

const TEMP_ROOT = join(tmpdir(), "media-downloader");
/**
 * Where "Save / This PC" writes permanent copies. Defaults to
 * `$HOME/Videos/Downloader`; set `MEDIA_DOWNLOADER_SAVE_DIR` to an absolute
 * path to redirect PC saves (used by tests and by operators who keep media
 * elsewhere). A relative or empty value is ignored so a bad setting can never
 * silently scatter files into the server's working directory.
 */
const SERVER_OUTPUT_DIR =
  absoluteSaveDir(process.env.MEDIA_DOWNLOADER_SAVE_DIR) ??
  join(homedir(), "Videos", "Downloader");

/** Accept only an absolute, non-empty override for the PC save directory. */
function absoluteSaveDir(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && isAbsolute(trimmed) ? trimmed : undefined;
}
const DOWNLOAD_TTL_MS = 6 * 60 * 60 * 1_000;
const COMPLETED_JOB_TTL_MS = 24 * 60 * 60 * 1_000;
const LOG_LIMIT = 8_000;

interface InternalDownloadJob extends DownloadJob {
  input?: CreateJobInput;
  copyInput?: { url: string; options: PostOptions };
  instagramInput?: InstagramJobInput;
  filePath?: string;
  cleanupScheduled?: boolean;
}

const globalJobs = globalThis as typeof globalThis & {
  __mediaDownloaderJobs?: Map<string, InternalDownloadJob>;
};

const jobs =
  globalJobs.__mediaDownloaderJobs ?? new Map<string, InternalDownloadJob>();
globalJobs.__mediaDownloaderJobs = jobs;

function now(): string {
  return new Date().toISOString();
}

function publicJob(job: InternalDownloadJob): DownloadJob {
  const {
    id,
    status,
    progress,
    speed,
    eta,
    filename,
    savedPath,
    error,
    errorKind,
    details,
    destination,
    createdAt,
    updatedAt,
  } = job;

  return {
    id,
    status,
    progress,
    speed,
    eta,
    filename,
    savedPath,
    error,
    errorKind,
    details: status === "error" ? details : undefined,
    destination,
    createdAt,
    updatedAt,
    fileUrl:
      status === "complete" && destination === "download" && job.filePath
        ? `/api/jobs/${id}/file`
        : undefined,
  };
}

function updateJob(job: InternalDownloadJob, patch: Partial<InternalDownloadJob>) {
  Object.assign(job, patch, { updatedAt: now() });
}

export function createDownloadJob(input: CreateJobInput): DownloadJob {
  pruneExpiredJobs();

  const id = randomUUID();
  const timestamp = now();
  const job: InternalDownloadJob = {
    id,
    status: "queued",
    destination: input.destination,
    input,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  jobs.set(id, job);
  setImmediate(() => void runJob(job));
  return publicJob(job);
}

export function createCopyXJob(url: string, options: PostOptions, destination: DownloadJob["destination"]): DownloadJob {
  pruneExpiredJobs();
  const id = randomUUID();
  const timestamp = now();
  const job: InternalDownloadJob = {
    id,
    status: "queued",
    destination,
    copyInput: { url, options },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  jobs.set(id, job);
  setImmediate(() => void runCopyXJob(job));
  return publicJob(job);
}

export function getDownloadJob(id: string): DownloadJob | undefined {
  pruneExpiredJobs();
  const job = jobs.get(id);
  return job ? publicJob(job) : undefined;
}

export function createInstagramJob(input: InstagramJobInput, destination: DownloadJob["destination"]): DownloadJob {
  pruneExpiredJobs();
  const timestamp = now();
  const job: InternalDownloadJob = { id: randomUUID(), status: "queued", destination, instagramInput: input, createdAt: timestamp, updatedAt: timestamp };
  jobs.set(job.id, job);
  setImmediate(() => void runInstagramJob(job));
  return publicJob(job);
}

async function runInstagramJob(job: InternalDownloadJob) {
  const jobDir = join(TEMP_ROOT, job.id);
  const outputDir = job.destination === "download" ? jobDir : SERVER_OUTPUT_DIR;
  try {
    await mkdir(jobDir, { recursive: true });
    updateJob(job, { status: "downloading" });
    const result = await instagramRequest<{ filePath: string }>("download", { ...job.instagramInput, outputDir, stagingDir: join(jobDir, "items") });
    const fileInfo = await stat(result.filePath);
    if (!fileInfo.isFile() || !fileInfo.size || dirname(result.filePath) !== outputDir) throw new Error("Instagram produced an invalid output file.");
    updateJob(job, { status: "complete", progress: 100, filePath: result.filePath, filename: basename(result.filePath), savedPath: job.destination === "server" ? result.filePath : undefined });
  } catch (error) {
    updateJob(job, { status: "error", error: error instanceof Error ? error.message : "Instagram download failed." });
    if (job.destination === "download") await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
  } finally {
    if (job.destination === "server") await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    scheduleExpiry(job);
  }
}

export function getInternalDownloadJob(id: string): InternalDownloadJob | undefined {
  pruneExpiredJobs();
  return jobs.get(id);
}

export function scheduleRetrievedFileCleanup(job: InternalDownloadJob) {
  if (job.cleanupScheduled || !job.filePath) return;
  job.cleanupScheduled = true;

  const timer = setTimeout(() => {
    const filePath = job.filePath;
    jobs.delete(job.id);
    if (filePath) void rm(dirname(filePath), { recursive: true, force: true });
  }, 15 * 60 * 1_000);
  timer.unref();
}

async function runJob(job: InternalDownloadJob) {
  const input = job.input;
  if (!input) return;
  const jobDir = join(TEMP_ROOT, job.id);
  const outputDir =
    job.destination === "download" ? jobDir : SERVER_OUTPUT_DIR;

  try {
    await mkdir(outputDir, { recursive: true });
    updateJob(job, { status: "downloading", progress: 0 });

    const outputTemplate = outputTemplateFor(outputDir);
    const args = buildYtDlpArgs(input, outputTemplate);
    let filePath: string | undefined;
    try {
      filePath = await spawnDownload(job, args);
    } catch (originalError) {
      if (!xPostId(input.url) || input.format === "webm") throw originalError;
      let items;
      try { items = await getXMedia(input.url); } catch { throw originalError; }
      const selected = items[input.itemIndex ? input.itemIndex - 1 : 0];
      if (!selected) throw originalError;
      if (input.type === "audio" && !selected.hasAudio) {
        throw new Error("This X video has no usable audio track.");
      }
      const height = typeof input.quality === "number" ? input.quality : Infinity;
      const variant = selected.variants.find((item) => item.height <= height)
        ?? selected.variants.at(-1);
      if (!variant) throw originalError;
      const safeTitle = sanitizeFileSegment(selected.title) || "X video";
      const fallbackTemplate = join(outputDir, `${safeTitle} [${selected.id}-${selected.index}].%(ext)s`);
      const fallbackInput = { ...input, url: variant.url, quality: "best" as const, itemIndex: undefined };
      updateJob(job, { status: "downloading", progress: 0, details: undefined });
      filePath = await spawnDownload(job, buildYtDlpArgs(fallbackInput, fallbackTemplate));
    }
    const resolvedPath = filePath ?? (await findOutputFile(jobDir));

    if (!resolvedPath) {
      throw new YtDlpError(
        "output",
        "yt-dlp finished, but the output file could not be located.",
      );
    }

    const fileInfo = await stat(resolvedPath);
    if (!fileInfo.isFile() || fileInfo.size === 0) {
      throw new YtDlpError(
        "output",
        "yt-dlp produced an empty or invalid output file.",
      );
    }

    updateJob(job, {
      status: "complete",
      progress: 100,
      speed: undefined,
      eta: undefined,
      filePath: resolvedPath,
      filename: basename(resolvedPath),
      savedPath: job.destination === "server" ? resolvedPath : undefined,
    });

    scheduleExpiry(job);
  } catch (error) {
    const original = error instanceof Error ? error : new Error("The download failed.");
    const friendly =
      "stderr" in original && typeof original.stderr === "string"
        ? classifyYtDlpError(original.stderr)
        : original;
    const details =
      "stderr" in original && typeof original.stderr === "string"
        ? cleanDetails(original.stderr)
        : undefined;

    updateJob(job, {
      status: "error",
      error: friendly.message,
      errorKind: errorKindOf(friendly),
      details,
      speed: undefined,
      eta: undefined,
    });

    if (job.destination === "download") {
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    }
    scheduleExpiry(job);
  }
}

async function runCopyXJob(job: InternalDownloadJob) {
  const input = job.copyInput;
  if (!input) return;
  const jobDir = join(TEMP_ROOT, job.id);
  const outputDir = job.destination === "download" ? jobDir : SERVER_OUTPUT_DIR;
  let outputPath: string | undefined;
  try {
    await mkdir(jobDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    updateJob(job, { status: "processing", progress: 0 });
    const post = await getXPost(input.url);
    const rendered = await renderPostImage(post, input.options);
    const safeHandle = post.handle.replace(/[^A-Za-z0-9_]/g, "").slice(0, 30) || "post";
    const name = `X post @${safeHandle} [${post.id}] [${input.options.ratio.replace(":", "x")}-${job.id.slice(0, 8)}].${input.options.output}`;
    outputPath = join(outputDir, name);
    if (input.options.output === "png") {
      await writeFile(outputPath, rendered.png);
    } else {
      const framePath = join(jobDir, "frame.png");
      await writeFile(framePath, rendered.png);
      const video = rendered.video;
      const playing = video && rendered.slot;
      const duration = playing ? Math.max(1, video.duration ?? input.options.seconds) : input.options.seconds;
      await spawnComposition(job, framePath, outputPath, input.options, playing ? video.videoUrl : undefined, rendered.slot, duration);
    }
    const fileInfo = await stat(/* turbopackIgnore: true */ outputPath);
    if (!fileInfo.isFile() || fileInfo.size === 0) throw new Error("The composed post file is empty.");
    updateJob(job, {
      status: "complete",
      progress: 100,
      filePath: outputPath,
      filename: name,
      savedPath: job.destination === "server" ? outputPath : undefined,
    });
    scheduleExpiry(job);
  } catch (error) {
    if (outputPath) await rm(outputPath, { force: true }).catch(() => undefined);
    updateJob(job, {
      status: "error",
      error: error instanceof Error ? error.message : "Could not compose this X post.",
      details: undefined,
    });
    if (job.destination === "download") {
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    }
    scheduleExpiry(job);
  } finally {
    if (job.destination === "server") {
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function spawnComposition(
  job: InternalDownloadJob,
  framePath: string,
  outputPath: string,
  options: PostOptions,
  videoUrl: string | undefined,
  slot: { x: number; y: number; width: number; height: number } | undefined,
  duration: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fade = options.animation === "fade" ? ",fade=t=in:st=0:d=0.55" : "";
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "30", "-i", framePath];
    if (videoUrl && slot) {
      // Avoid leaving a job stuck forever if X's media CDN stops responding.
      args.push("-rw_timeout", "20000000", "-i", videoUrl);
      args.push(
        "-filter_complex",
        `[1:v]scale=${slot.width}:${slot.height}:force_original_aspect_ratio=decrease,pad=${slot.width}:${slot.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[clip];[0:v][clip]overlay=${slot.x}:${slot.y}${fade},format=yuv420p[v]`,
        "-map", "[v]", "-map", "1:a?",
      );
    } else {
      args.push("-vf", `format=yuv420p${fade}`);
    }
    args.push("-t", String(duration), "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", outputPath);
    const child = spawn("ffmpeg", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve();
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("out_time_ms=")) continue;
        const micros = Number(line.slice("out_time_ms=".length));
        if (Number.isFinite(micros)) updateJob(job, { progress: Math.min(99, Math.round(micros / (duration * 10_000))) });
      }
    });
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-LOG_LIMIT); });
    child.on("error", (error) => finish(new Error(error.message)));
    child.on("close", (code) => finish(code === 0 ? undefined : new Error(`ffmpeg could not compose this post. ${cleanDetails(stderr).slice(-500)}`)));
  });
}

// yt-dlp argument construction and filename policy live in
// `src/lib/download-args.ts` (pure + unit-tested).

function spawnDownload(
  job: InternalDownloadJob,
  args: string[],
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let outputPath: string | undefined;
    let settled = false;

    const finish = (error?: Error & { stderr?: string }) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(outputPath);
    };

    const handleLine = (line: string, fromStderr = false) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.startsWith("__PROGRESS__")) {
        const [percentText, speedText, etaText] = trimmed
          .slice("__PROGRESS__".length)
          .split("|");
        const percent = Number.parseFloat(percentText.replace("%", "").trim());
        updateJob(job, {
          status: "downloading",
          progress: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : undefined,
          speed: normalizeProgressValue(speedText),
          eta: normalizeProgressValue(etaText),
        });
        return;
      }

      if (trimmed.startsWith("__FILE__")) {
        outputPath = trimmed.slice("__FILE__".length).trim();
        return;
      }

      // `--no-overwrites` makes yt-dlp skip an existing file instead of
      // clobbering it; it then reports the surviving path here. Capture that
      // path so a re-download still resolves to a real, non-destructive file.
      if (/\bhas already been downloaded\b/i.test(trimmed)) {
        const candidate = trimmed
          .replace(/^\[[^\]]+\]\s*/, "")
          .replace(/\s*has already been downloaded.*$/i, "")
          .trim();
        if (candidate) outputPath = candidate;
        updateJob(job, { status: "processing", progress: 100 });
        return;
      }

      if (
        fromStderr &&
        /\[(Merger|ExtractAudio|VideoRemuxer|VideoConvertor|Fixup|Metadata)\]/.test(trimmed)
      ) {
        updateJob(job, { status: "processing", progress: 100 });
      }
    };

    const consumeLines = (chunk: string, fromStderr: boolean) => {
      if (fromStderr) {
        stderrBuffer += chunk;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line, true);
      } else {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => consumeLines(chunk, false));
    child.stderr.on("data", (chunk: string) => {
      consumeLines(chunk, true);
      job.details = cleanDetails((job.details ?? "") + chunk);
    });

    child.on("error", (error) => {
      const friendly =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("yt-dlp was not found in PATH.")
          : new Error(`Unable to start yt-dlp: ${error.message}`);
      finish(friendly);
    });

    child.on("close", (code) => {
      handleLine(stdoutBuffer);
      handleLine(stderrBuffer, true);
      if (code === 0) {
        finish();
      } else {
        const error = new Error(`yt-dlp exited with code ${code ?? "unknown"}.`) as Error & {
          stderr?: string;
        };
        error.stderr = job.details ?? stderrBuffer;
        finish(error);
      }
    });
  });
}

function normalizeProgressValue(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned && cleaned !== "NA" && cleaned !== "Unknown" ? cleaned : undefined;
}

function cleanDetails(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").trim().slice(-LOG_LIMIT);
}

async function findOutputFile(directory: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const file = entries.find(
    (entry) => entry.isFile() && !entry.name.endsWith(".part") && !entry.name.endsWith(".ytdl"),
  );
  return file ? join(directory, file.name) : undefined;
}

function scheduleExpiry(job: InternalDownloadJob) {
  const ttl = job.destination === "download" ? DOWNLOAD_TTL_MS : COMPLETED_JOB_TTL_MS;
  const timer = setTimeout(() => {
    const current = jobs.get(job.id);
    if (current !== job || !["complete", "error"].includes(job.status)) return;
    jobs.delete(job.id);
    if (job.destination === "download") {
      void rm(join(TEMP_ROOT, job.id), { recursive: true, force: true });
    }
  }, ttl);
  timer.unref();
}

function pruneExpiredJobs() {
  const currentTime = Date.now();
  for (const [id, job] of jobs) {
    if (!["complete", "error"].includes(job.status)) continue;
    const age = currentTime - new Date(job.updatedAt).getTime();
    const ttl = job.destination === "download" ? DOWNLOAD_TTL_MS : COMPLETED_JOB_TTL_MS;
    if (age > ttl) {
      jobs.delete(id);
      if (job.destination === "download") {
        void rm(join(TEMP_ROOT, id), { recursive: true, force: true });
      }
    }
  }
}
