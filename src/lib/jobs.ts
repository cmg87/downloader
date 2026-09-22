import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type {
  AudioFormat,
  CreateJobInput,
  DownloadJob,
  DownloadQuality,
  VideoFormat,
} from "@/lib/types";
import { classifyYtDlpError } from "@/lib/yt-dlp";

const TEMP_ROOT = join(tmpdir(), "media-downloader");
const SERVER_OUTPUT_DIR = join(homedir(), "Videos", "Downloader");
const DOWNLOAD_TTL_MS = 6 * 60 * 60 * 1_000;
const COMPLETED_JOB_TTL_MS = 24 * 60 * 60 * 1_000;
const LOG_LIMIT = 8_000;

interface InternalDownloadJob extends DownloadJob {
  input: CreateJobInput;
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

export function getDownloadJob(id: string): DownloadJob | undefined {
  pruneExpiredJobs();
  const job = jobs.get(id);
  return job ? publicJob(job) : undefined;
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
  const jobDir = join(TEMP_ROOT, job.id);
  const outputDir =
    job.destination === "download" ? jobDir : SERVER_OUTPUT_DIR;

  try {
    await mkdir(outputDir, { recursive: true });
    updateJob(job, { status: "downloading", progress: 0 });

    const outputTemplate = join(
      outputDir,
      "%(title)s [%(id)s].%(ext)s",
    );
    const args = buildYtDlpArgs(job.input, outputTemplate);
    const filePath = await spawnDownload(job, args);
    const resolvedPath = filePath ?? (await findOutputFile(jobDir));

    if (!resolvedPath) {
      throw new Error("yt-dlp finished, but the output file could not be located.");
    }

    const fileInfo = await stat(resolvedPath);
    if (!fileInfo.isFile() || fileInfo.size === 0) {
      throw new Error("yt-dlp produced an empty or invalid output file.");
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

function buildYtDlpArgs(input: CreateJobInput, outputTemplate: string): string[] {
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--no-colors",
    "--newline",
    "--trim-filenames",
    "180",
    "--progress-template",
    "download:__PROGRESS__%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
    "--print",
    "after_move:__FILE__%(filepath)s",
    "--output",
    outputTemplate,
  ];

  if (input.type === "audio") {
    args.push(
      "--extract-audio",
      "--audio-format",
      input.format as AudioFormat,
      "--audio-quality",
      "0",
    );
  } else {
    const format = input.format as VideoFormat;
    args.push("--format", videoSelector(input.quality ?? "best", format));
    args.push("--merge-output-format", format, "--remux-video", format);
  }

  args.push("--", input.url);
  return args;
}

function videoSelector(quality: DownloadQuality, format: VideoFormat): string {
  const height = typeof quality === "number" ? `[height<=${quality}]` : "";

  if (format === "mp4") {
    return [
      `bestvideo${height}[ext=mp4]+bestaudio[ext=m4a]`,
      `best${height}[ext=mp4]`,
      `bestvideo${height}+bestaudio`,
      `best${height}`,
      "best",
    ].join("/");
  }

  if (format === "webm") {
    return [
      `bestvideo${height}[ext=webm]+bestaudio[ext=webm]`,
      `best${height}[ext=webm]`,
    ].join("/");
  }

  return [
    `bestvideo${height}+bestaudio`,
    `best${height}`,
    "best",
  ].join("/");
}

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
