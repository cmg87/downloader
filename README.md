# Media Downloader

A small personal web interface for downloading media with the `yt-dlp` and `ffmpeg` binaries already installed on the host. Paste a supported URL, inspect the formats exposed by `yt-dlp`, choose an output, and either download it to the current browser or save it on the server.

The top tabs provide three workflows: **Download media** preserves the original URL-to-file behavior, while **Copy X post** makes a styled PNG or MP4 of a public X post, including its author, text, date, available metrics, and a media item. Attached video plays inside MP4 exports with its original audio and duration. Text-only/image posts become a short 3-, 5-, or 10-second clip. Choose a canvas ratio, light/dark post card, background, and a subtle fade or static presentation. The **Instagram** tab uses Instaloader for photos, videos, carousels, and current stories. Public posts and reels can be tried without login; stories use a saved Instagram session. All three workflows use the same Download (current device) and Save (this PC) actions.

There is no application authentication. Put the app behind Cloudflare Access before exposing it outside your local machine.

## Requirements

- Node.js and npm
- `yt-dlp` available in `PATH`
- `ffmpeg` available in `PATH`
- `ffprobe` available in `PATH` for audio detection on X fallback videos (normally installed with `ffmpeg`)

Check the system binaries with:

```bash
command -v yt-dlp && yt-dlp --version
command -v ffmpeg && ffmpeg -version
```

The app deliberately does not install or bundle either binary.

### Instagram setup and login

Install the isolated Python dependency once:

```bash
bash scripts/setup-instagram.sh
```

Paste a public post or reel link to try downloading without login. Instagram can
require a session for some public links; the app reports that response instead
of blocking the input beforehand. Stories require login through Instaloader.

Click **Log in with Instagram** to open Instagram’s real sign-in page in a
dedicated Chrome window **on the PC running the app**. Enter credentials and
complete any verification on Instagram itself. The app watches that window,
validates its session with Instaloader, saves it, and closes the sign-in window
when ready. If validation fails, the window stays open and the app shows the
problem. A phone can request this flow, but sign-in must be completed on the PC.
Chrome and a running desktop session are needed for browser sign-in.

The dedicated browser profile is in
`$HOME/.config/media-downloader/instagram/browser-profile`; it is separate from
your everyday Chrome profile. The app never reads your existing browser profile.
The Instaloader session is saved in
`$HOME/.config/media-downloader/instagram/session.json` and reused after app
restarts. Sign out clears both this saved session and the app’s browser profile.
Instagram controls expiry and can revoke the session.

The collapsed **Use username and password instead** form retains Instaloader’s
direct login as an alternative, with in-app code entry and checkpoint links.
If Instagram rejects direct login, use browser sign-in. Public post downloads
remain available while login is pending or has failed.

Set `MEDIA_DOWNLOADER_INSTAGRAM_PYTHON` to use another Python executable with
Instaloader installed, and `MEDIA_DOWNLOADER_INSTAGRAM_DIR` to change the session
folder. The app and Python worker must run on the same host.

### X/Twitter posts

`yt-dlp` remains the default extractor. Some X posts contain multiple videos; the app shows a separate Video 1/Video 2 choice for those posts. If `yt-dlp` cannot read a public X video, the app checks the post ID with the public [FxTwitter API](https://github.com/FxEmbed/FxEmbed/tree/main/docs), then downloads a validated MP4 URL from `video.twimg.com` through the normal job flow. This fallback sends the public post ID to FxTwitter. It does not use browser cookies and cannot access private or login-only posts; availability can vary with X and the third-party API.

The separate Copy X post tab also reads public post metadata through FxTwitter and requests English translation when available. It does not call the TwitterShots service, add accounts, or need AI. PNGs are rendered locally; MP4s are composed with the system `ffmpeg`. If FxTwitter cannot provide a translation, the original post text is retained. If a post is too long to fit legibly at the selected ratio, choose a taller canvas or hide optional date/metrics rather than silently dropping text. For multi-media posts, the card highlights one media item and notes how many additional items the post contains.

Quoted posts retain their author, text, and media inside the quote card. Each post and quote highlights one media item; MP4 exports prefer a playable video. If both the outer post and quote contain videos, the outer video's audio and motion are used while the quote shows its thumbnail. When only the quote contains a video, that video plays with its audio in the quote card.

### Threads support

Public Threads video posts are supported through the third-party [`yt-dlp-threads`](https://github.com/tribixbite/yt-dlp-threads) extractor plugin. On this desktop it is installed in yt-dlp's user plugin directory:

```text
$HOME/.config/yt-dlp/plugins/yt-dlp-threads/yt_dlp_plugins/extractor/threads.py
```

The plugin supports public `threads.com` and `threads.net` post, share, and multi-video URLs. Private, login-gated, image-only, and text-only posts are not supported. Because extraction depends on Threads' server-rendered crawler metadata, a future Threads layout change may require updating the plugin.

To verify discovery:

```bash
yt-dlp --verbose --simulate "https://www.threads.com/@user/post/POST_ID"
```

The debug output should include `Extractor Plugins: ThreadsIE`.

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
- `GET/POST /api/instagram/session` reads the local login state and handles login, verification, retry, and sign-out.
- `POST /api/instagram/inspect` reads post or story metadata with the saved Instaloader session.
- `POST /api/instagram/jobs` downloads selected original files through the shared job/file flow.
- `POST /api/jobs` creates an in-memory job and immediately returns its ID.
- `GET /api/jobs/:id` reports queued, downloading, processing, complete, or error state.
- `GET /api/jobs/:id/file` streams a completed temporary file with `Content-Disposition: attachment`.

Browser downloads are prepared beneath the operating system temp directory at `/tmp/media-downloader/<job-id>` on a typical Linux machine. They expire after six hours if never retrieved and are removed 15 minutes after retrieval. Server saves are permanent and go to:

```text
$HOME/Videos/Downloader
```

The destination directory is created automatically. Jobs exist only in memory, so restarting the Next.js process clears their status, which is intentional for this single-user utility.

### Where files end up

The Instagram tab handles logged-in downloads separately from yt-dlp. Paste a
post/reel/story link, a profile link, or `@username` to fetch current stories.
Choose individual photos/videos or download multiple selections as a ZIP.
Highlights are not supported.

Choose where the file lands with the two actions on every result:

- **Save / This PC** writes a permanent copy to `$HOME/Videos/Downloader`. The exact path is shown in the result panel once the job completes. Files are named `Title [media-id].ext`, sanitized and length-capped, and the app never overwrites an existing file — a repeat download keeps the file that is already there.
- **Download / This device** prepares a temporary copy (`/tmp/media-downloader/<job-id>`) and streams it to the browser that is running the app, so it lands in that browser's normal download folder (e.g. `~/Downloads`). The temporary copy expires after six hours, or fifteen minutes after it is retrieved.

### Downloading onto a phone

Open this same web UI from the phone using `http://<pc-lan-ip>:43827` on the
same Wi-Fi/LAN or the Cloudflare tunnel hostname from [CLOUDFLARE.md](./CLOUDFLARE.md).
Use **Download / This device** to deliver the file to the phone’s browser.

## Cloudflare

See [CLOUDFLARE.md](./CLOUDFLARE.md). Caddy, Cloudflare Tunnel, and Cloudflare Access are intentionally not configured by this repository.
