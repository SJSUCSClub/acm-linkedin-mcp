#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
EXTENSION_DIR="$REPO_ROOT/extension"
TEMPLATE_MANIFEST="$BACKEND_DIR/com.acm.snapshot_host.json"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed. Install it first (e.g. 'brew install uv')" >&2
  exit 1
fi

if [[ ! -f "$TEMPLATE_MANIFEST" ]]; then
  echo "Missing template manifest: $TEMPLATE_MANIFEST" >&2
  exit 1
fi

EXTENSION_ID="${1:-}"
BROWSER_FLAVOR="${2:-}"

if [[ -z "${EXTENSION_ID}" || "${EXTENSION_ID}" == "--chromium" ]]; then
  read -r -p "Chrome extension ID: " EXTENSION_ID
  if [[ -z "${BROWSER_FLAVOR}" ]]; then
    BROWSER_FLAVOR="${1:-}"
  fi
fi
if [[ -z "${EXTENSION_ID}" ]]; then
  echo "Extension ID cannot be empty. Usage: ./scripts/install_macos_chrome.sh <extension_id>" >&2
  exit 1
fi

if [[ ! -x "$BACKEND_DIR/.venv/bin/python" ]]; then
  uv venv --python=3.12 "$BACKEND_DIR/.venv"
fi
if ! "$BACKEND_DIR/.venv/bin/python" -m pip --version >/dev/null 2>&1; then
  "$BACKEND_DIR/.venv/bin/python" -m ensurepip --upgrade
fi
"$BACKEND_DIR/.venv/bin/python" -m pip install --upgrade pip
"$BACKEND_DIR/.venv/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"

WRAPPER_DIR="$HOME/.local/bin"
WRAPPER_PATH="$WRAPPER_DIR/acm_snapshot_host"
mkdir -p "$WRAPPER_DIR"

cat > "$WRAPPER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
"$BACKEND_DIR/.venv/bin/python" "$BACKEND_DIR/native_host.py"
EOF
chmod +x "$WRAPPER_PATH"

if [[ "${BROWSER_FLAVOR}" == "--chromium" ]]; then
  HOST_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
else
  HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
fi
mkdir -p "$HOST_DIR"

MANIFEST_DST="$HOST_DIR/com.acm.snapshot_host.json"
python3 - <<PY
import json
from pathlib import Path

template_path = Path(r"$TEMPLATE_MANIFEST")
dst_path = Path(r"$MANIFEST_DST")

obj = json.loads(template_path.read_text())
obj["path"] = r"$WRAPPER_PATH"
obj["allowed_origins"] = [f"chrome-extension://{r'$EXTENSION_ID'}/"]
dst_path.write_text(json.dumps(obj, indent=2) + "\n")
print(f"Wrote: {dst_path}")
PY

echo
printf "Next:\n"
printf "1) Build the extension: (cd %s && npm install && npm run build)\n" "$EXTENSION_DIR"
printf "2) Load unpacked extension from: %s/dist\n" "$EXTENSION_DIR"
printf "3) Restart Chrome\n"
printf "4) Run backend: (cd %s && source .venv/bin/activate && fastapi dev app.py)\n" "$BACKEND_DIR"
printf "5) Verify: curl -X POST http://127.0.0.1:8000/snapshot\n"
