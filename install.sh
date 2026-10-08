#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/share/media-downloader"
YTDLP_ENV="$INSTALL_DIR/yt-dlp-venv"
NODE_MAJOR=22

say() { printf '\n==> %s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

install_system_packages() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    command -v brew >/dev/null 2>&1 || fail "Install Homebrew first: https://brew.sh"
    brew install node ffmpeg python git
    brew install --cask google-chrome
    return
  fi

  [[ -r /etc/os-release ]] || fail "This installer supports Ubuntu/Debian Linux and macOS."
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == ubuntu || "${ID:-}" == debian || "${ID_LIKE:-}" == *debian* ]] || \
    fail "This installer supports Ubuntu/Debian Linux and macOS."
  [[ "$(dpkg --print-architecture)" == amd64 ]] || \
    fail "The automatic Chrome install currently supports amd64 Ubuntu/Debian. Install Google Chrome manually on this architecture, then rerun the script."
  command -v apt-get >/dev/null 2>&1 || fail "apt-get is required on Ubuntu/Debian."
  local sudo_cmd=()
  if [[ "$EUID" -ne 0 ]]; then
    command -v sudo >/dev/null 2>&1 || fail "Install system packages as root or install sudo."
    sudo_cmd=(sudo)
  fi
  "${sudo_cmd[@]}" apt-get update
  "${sudo_cmd[@]}" apt-get install -y ca-certificates curl ffmpeg git gnupg python3 python3-pip python3-venv

  # Instagram sign-in uses a visible Chrome window on the machine running this app.
  local keyring=/usr/share/keyrings/google-chrome.gpg
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | "${sudo_cmd[@]}" gpg --dearmor --yes -o "$keyring"
  echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main' | \
    "${sudo_cmd[@]}" tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
  "${sudo_cmd[@]}" apt-get update
  "${sudo_cmd[@]}" apt-get install -y google-chrome-stable
}

ensure_node() {
  if command -v nvm >/dev/null 2>&1; then
    :
  elif [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "$HOME/.nvm/nvm.sh"
  fi
  if command -v node >/dev/null 2>&1 && node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1)'; then
    return
  fi
  [[ "$(uname -s)" == Darwin ]] && fail "Node.js 20 or newer was not found. Install it with Homebrew, then rerun this script."
  say "Installing Node.js $NODE_MAJOR with nvm"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  mkdir -p "$NVM_DIR"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm install "$NODE_MAJOR"
  nvm use "$NODE_MAJOR"
}

say "Installing operating system tools"
install_system_packages
ensure_node
command -v npm >/dev/null 2>&1 || fail "npm was not found alongside Node.js."
command -v ffmpeg >/dev/null 2>&1 || fail "ffmpeg installation failed."
command -v google-chrome >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1 || \
  [[ "$(uname -s)" == Darwin ]] || fail "Chrome installation failed."

say "Installing app dependencies and building"
cd "$APP_DIR"
npm ci
npm run build

say "Installing yt-dlp in an isolated Python environment"
mkdir -p "$INSTALL_DIR"
if [[ ! -x "$YTDLP_ENV/bin/python" ]]; then
  python3 -m venv "$YTDLP_ENV"
fi
"$YTDLP_ENV/bin/python" -m pip install --upgrade pip yt-dlp

say "Installing the isolated Instaloader environment"
bash "$APP_DIR/scripts/setup-instagram.sh"

say "Starting the app with PM2"
export PATH="$YTDLP_ENV/bin:$HOME/.local/bin:$PATH"
npm install --global pm2
if pm2 describe downloader >/dev/null 2>&1; then
  pm2 restart downloader --update-env
else
  pm2 start npm --name downloader -- start
fi
pm2 save

printf '\nSetup is complete. Open http://localhost:43827\n'
printf 'On a machine without a desktop, Instagram browser sign-in is unavailable; other downloads still work.\n'
printf 'Use README.md for Cloudflare Access or Tailscale setup.\n'
