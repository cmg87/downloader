# Media Downloader

A personal web interface for downloading media with `yt-dlp` and `ffmpeg`. It has three tabs:

- **Download media** inspects supported links and downloads the available video or audio.
- **Copy X post** makes a styled PNG or MP4 of a public X post, including its author, text, date, available metrics, and media. Attached video keeps its audio and duration; text and image posts become short clips.
- **Instagram** uses Instaloader for photos, videos, carousels, and current stories. Public posts and reels can be tried without login; stories use the saved Instagram session.

All tabs offer **Download (this device)** and **Save (this PC)**. The app has no built-in user authentication, so protect it with Cloudflare Access or keep it inside your Tailscale network before opening it from another device.

## Install and start

On Ubuntu/Debian Linux or macOS, clone or download this repository, open a terminal in its folder, then run:

```bash
bash install.sh
```

The script installs the prerequisites (Node.js, ffmpeg, Python, yt-dlp, Instaloader, and Google Chrome for the Instagram sign-in window), builds the production app, and starts it as a background PM2 process named `downloader`. On Ubuntu/Debian it uses `sudo` to install system packages; on macOS it uses Homebrew. It can be run again to update dependencies and restart the app.

Open [http://localhost:43827](http://localhost:43827) on the computer running the app. To have PM2 restore it after a reboot, run `pm2 startup` once, follow the command PM2 prints, then run `pm2 save`.

The installer supports Ubuntu/Debian and macOS. On other Linux distributions, install Node.js 20.9+, npm, Python with venv/pip, ffmpeg/ffprobe, yt-dlp, and Google Chrome yourself, then run:

```bash
npm ci
npm run build
bash scripts/setup-instagram.sh
npm start
```

### Instagram login and session

Click **Log in with Instagram** to open Instagram’s real sign-in page in a dedicated Chrome window on the computer running the app. Enter credentials and complete any code or checkpoint on Instagram itself. The app validates the browser session with Instaloader and saves it for subsequent downloads. A phone can request this flow, but the sign-in window opens on the app computer.

The dedicated Chrome profile and Instaloader session are stored locally in `$HOME/.config/media-downloader/instagram/`. The app does not read your everyday browser profile. The session survives app restarts; Instagram can expire or revoke it. Sign out clears the saved session and the dedicated sign-in profile. Public post downloads remain available while login is pending or has failed.

Instaloader is installed into its own Python environment by the setup script. To change its location or Python interpreter, set `MEDIA_DOWNLOADER_INSTAGRAM_DIR` or `MEDIA_DOWNLOADER_INSTAGRAM_PYTHON` for the app process.

### X and Threads

`yt-dlp` remains the default extractor for X. Some posts contain multiple videos; the app shows a separate choice for each. If `yt-dlp` cannot read a public X video, the app checks the post ID with the public [FxTwitter API](https://github.com/FxEmbed/FxEmbed/tree/main/docs), then downloads a validated MP4 URL from `video.twimg.com`. This does not use browser cookies and cannot access private or login-only posts.

The Copy X post tab reads public post metadata through FxTwitter and requests an English translation when available. PNGs are rendered locally; MP4s use the system `ffmpeg`. Quoted posts retain their author, text, and media inside the quote card.

Public Threads video posts are supported through the third-party [`yt-dlp-threads`](https://github.com/tribixbite/yt-dlp-threads) plugin. Install it into the same Python environment as yt-dlp if you need Threads downloads:

```bash
"$HOME/.local/share/media-downloader/yt-dlp-venv/bin/python" -m pip install \
  'git+https://github.com/tribixbite/yt-dlp-threads'
```

The plugin supports public `threads.com` and `threads.net` video posts. Private, login-gated, image-only, and text-only posts are not supported. Verify discovery with:

```bash
"$HOME/.local/share/media-downloader/yt-dlp-venv/bin/yt-dlp" --verbose --simulate \
  'https://www.threads.com/@user/post/POST_ID'
```

The output should include `Extractor Plugins: ThreadsIE`.

## Use it from a phone or another computer

The app listens on port `43827`. You can expose it remotely in either of these ways:

- **Cloudflare Access and Tunnel:** use a public hostname with an Access allow policy for your account. The configuration matching this setup is in [CLOUDFLARE.md](./CLOUDFLARE.md).
- **Tailscale Serve:** keep the app private to your tailnet. Install and sign in to Tailscale on the app computer and phone, then follow the [Tailscale steps below](#tailscale-private-access).

Use **Download (this device)** to put the file in the browser’s usual download folder on the phone. Use **Save (this PC)** to save it on the machine running the app.

### Tailscale private access

With Tailscale installed and connected on both devices, run this on the computer hosting the app:

```bash
tailscale serve --bg 43827
tailscale serve status
```

Open the HTTPS URL reported by `tailscale serve status` on another device signed in to your tailnet. Serve keeps running in the background across reboots. Tailscale access controls still apply, and the service stays within your tailnet; don’t use Tailscale Funnel if you want private access. See the official [Tailscale Serve guide](https://tailscale.com/docs/features/tailscale-serve) and [CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Where files go

- **Save (this PC)** writes a permanent copy under `$HOME/Videos/Downloader`. Existing files are not overwritten.
- **Download (this device)** prepares a temporary copy under `/tmp/media-downloader/<job-id>` on Linux (the OS temporary directory elsewhere) and streams it to the requesting browser. Unretrieved files expire after six hours and retrieved files are removed after fifteen minutes.

Jobs exist only in memory, so restarting the app clears their status. The downloaded files remain on disk. The Instagram tab also accepts profile links or `@username` for current stories; highlights are not supported.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:43827](http://localhost:43827). Production scripts are `npm run build` and `npm start`.

## API overview

- `POST /api/inspect` asks yt-dlp for metadata without downloading media.
- `GET/POST /api/instagram/session` reads the local login state and handles login, verification, retry, and sign-out.
- `POST /api/instagram/inspect` reads post or story metadata with the saved Instaloader session.
- `POST /api/instagram/jobs` downloads selected original files.
- `POST /api/jobs` creates a download job; `GET /api/jobs/:id` reports its status; `GET /api/jobs/:id/file` streams its completed file.
