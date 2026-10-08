import { createDownloadJob } from "@/lib/jobs";
import type {
  AudioFormat,
  CreateJobInput,
  DownloadDestination,
  DownloadType,
  VideoFormat,
} from "@/lib/types";
import { validateMediaUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const videoFormats = new Set<VideoFormat>(["mp4", "mkv", "webm"]);
const audioFormats = new Set<AudioFormat>(["m4a", "mp3", "opus"]);
const destinations = new Set<DownloadDestination>(["download", "server"]);
const types = new Set<DownloadType>(["video", "audio", "image"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const url = validateMediaUrl(body.url);

    if (!types.has(body.type as DownloadType)) {
      throw new Error("Choose video, audio, or image only.");
    }
    if (!destinations.has(body.destination as DownloadDestination)) {
      throw new Error("Choose Download or Save.");
    }

    const type = body.type as DownloadType;
    const format = String(body.format ?? "").toLowerCase();
    if (type === "video" && !videoFormats.has(format as VideoFormat)) {
      throw new Error("Choose MP4, MKV, or WebM for video.");
    }
    if (type === "audio" && !audioFormats.has(format as AudioFormat)) {
      throw new Error("Choose M4A, MP3, or Opus for audio.");
    }
    if (type === "image" && format !== "original") {
      throw new Error("Images keep their original format.");
    }

    let quality: CreateJobInput["quality"];
    if (type === "video") {
      if (body.quality === "best") {
        quality = "best";
      } else if (
        typeof body.quality === "number" &&
        Number.isInteger(body.quality) &&
        body.quality > 0 &&
        body.quality <= 16_384
      ) {
        quality = body.quality;
      } else {
        throw new Error("Choose a valid video quality.");
      }
    }

    let itemIndex: number | undefined;
    if (body.itemIndex !== undefined) {
      if (typeof body.itemIndex !== "number" || !Number.isInteger(body.itemIndex) || body.itemIndex < 1 || body.itemIndex > 20) {
        throw new Error("Choose a valid video from this post.");
      }
      itemIndex = body.itemIndex;
    }

    const job = createDownloadJob({
      url,
      type,
      quality,
      format: format as CreateJobInput["format"],
      destination: body.destination as DownloadDestination,
      itemIndex,
    });

    return Response.json(job, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the download job.";
    return Response.json({ error: message }, { status: 400 });
  }
}
