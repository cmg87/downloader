import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { InstagramSession } from "@/lib/instagram/types";

export class InstagramError extends Error {
  session?: InstagramSession;
  constructor(message: string, session?: InstagramSession) {
    super(message);
    this.session = session;
  }
}
interface Bridge {
  child: ChildProcessWithoutNullStreams;
  queue: Promise<unknown>;
  nextId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
}
const state = globalThis as typeof globalThis & { __instagramBridge?: Bridge };

function bridge(): Bridge {
  if (state.__instagramBridge) return state.__instagramBridge;
  const venv = join(homedir(), ".config/media-downloader/instaloader-venv/bin/python");
  const python = process.env.MEDIA_DOWNLOADER_INSTAGRAM_PYTHON || (existsSync(venv) ? venv : "python3");
  const script = process.env.MEDIA_DOWNLOADER_INSTAGRAM_WORKER || join(process.cwd(), "scripts/instagram-worker.py");
  const child = spawn(python, ["-u", script], { shell: false, stdio: ["pipe", "pipe", "pipe"] });
  const instance: Bridge = { child, queue: Promise.resolve(), nextId: 0, pending: new Map() };
  state.__instagramBridge = instance;
  let missingModule = false;
  // Consume, never publish, Python tracebacks (they can contain account/session details).
  child.stderr.on("data", (chunk: Buffer) => { if (chunk.toString().includes("No module named 'instaloader'")) missingModule = true; });
  const fail = (message: string) => {
    if (state.__instagramBridge === instance) state.__instagramBridge = undefined;
    for (const pending of instance.pending.values()) { clearTimeout(pending.timer); pending.reject(new InstagramError(message)); }
    instance.pending.clear();
  };
  child.on("error", () => fail("Could not start Instagram support. Check the Python setup in README."));
  child.stdin.on("error", () => fail("Instagram support stopped. Try again."));
  child.on("close", () => fail(missingModule ? "Instaloader is not installed. Run the Instagram setup in README." : "Instagram support stopped. Try again."));
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const reply = JSON.parse(line);
      const pending = instance.pending.get(reply.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      instance.pending.delete(reply.id);
      if (reply.error) pending.reject(new InstagramError(reply.error, reply.session));
      else pending.resolve(reply.result);
    } catch { fail("Instagram support returned an invalid response. Try again."); child.kill(); }
  });
  return instance;
}

export function instagramRequest<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const instance = bridge();
  const result = instance.queue.then(() => new Promise<T>((resolve, reject) => {
    if (instance.child.exitCode !== null || instance.child.killed) { reject(new InstagramError("Instagram support restarted. Try again.")); return; }
    const id = ++instance.nextId;
    const timer = setTimeout(() => {
      instance.pending.delete(id);
      reject(new InstagramError("Instagram took too long to respond. Try again; a pending login may need to be restarted."));
      instance.child.kill();
    }, action === "download" ? 10 * 60_000 : 2 * 60_000);
    instance.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    instance.child.stdin.write(JSON.stringify({ ...data, action, id }) + "\n");
  }));
  instance.queue = result.catch(() => undefined);
  return result;
}
