# Media Downloader

A small personal web interface for downloading media with the `yt-dlp` and `ffmpeg` binaries already installed on the host. Paste a supported URL, inspect the formats exposed by `yt-dlp`, choose an output, and either download it to the current browser or save it on the server.

There is no application authentication. Put the app behind Cloudflare Access before exposing it outside your local machine.

## Requirements

- Node.js and npm
- `yt-dlp` available in `PATH`
- `ffmpeg` available in `PATH`

Check the system binaries with:

```bash
command -v yt-dlp && yt-dlp --version
command -v ffmpeg && ffmpeg -version
```

The app deliberately does not install or bundle either binary.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:43827](http://localhost:43827).

For a production build:

```bash
npm run build
npm start
```

Both development and production scripts use the dedicated high port `43827` to avoid conflicts with common local services.

## How it works

- `POST /api/inspect` asks `yt-dlp` for metadata only. It does not download the media.
- `POST /api/jobs` creates an in-memory job and immediately returns its ID.
- `GET /api/jobs/:id` reports queued, downloading, processing, complete, or error state.
- `GET /api/jobs/:id/file` streams a completed temporary file with `Content-Disposition: attachment`.

Browser downloads are prepared beneath the operating system temp directory at `/tmp/media-downloader/<job-id>` on a typical Linux machine. They expire after six hours if never retrieved and are removed 15 minutes after retrieval. Server saves are permanent and go to:

```text
$HOME/Videos/Downloader
```

The destination directory is created automatically. Jobs exist only in memory, so restarting the Next.js process clears their status, which is intentional for this single-user utility.

## Cloudflare

See [CLOUDFLARE.md](./CLOUDFLARE.md). Caddy, Cloudflare Tunnel, and Cloudflare Access are intentionally not configured by this repository.
