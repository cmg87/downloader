#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
instagram_env="${HOME}/.config/media-downloader/instaloader-venv"
if ! python3 -m venv "$instagram_env"; then
  # Some distributions omit ensurepip but provide a standalone pip.
  python3 -m venv --without-pip "$instagram_env"
fi
if "$instagram_env/bin/python" -m pip --version >/dev/null 2>&1; then
  "$instagram_env/bin/python" -m pip install -r "$script_dir/requirements-instagram.txt"
elif command -v pip3 >/dev/null 2>&1; then
  pip3 --python "$instagram_env/bin/python" install -r "$script_dir/requirements-instagram.txt"
else
  echo 'Install the Python venv/pip package for your OS, then rerun this script.' >&2
  exit 1
fi
