# ACM LinkedIn MCP

This repository contains two primary components:

1. **FastAPI backend** (`backend/`) – serves as the control plane for snapshot commands and receives HTML from the extension.
2. **Chrome extension** (`extension/`) – a plain MV3 extension written in TypeScript. It communicates with the backend through a native messaging host.

---

## Architecture Overview

- **Backend** exposes:
  - `/snapshot` – request a page snapshot; returns the HTML once the
    extension has captured it. Internally this endpoint enqueues a task
    on an async queue and suspends until the native host process delivers
    a response, ensuring FIFO ordering.
  - `/response` – called by the native host to deliver HTML for a
    previously-issued snapshot request (providing the matching request id).
  - `/command` – polled by the native host to obtain the next request id.

- **Native messaging host**:
  - When Chrome launches the executable specified in
    `backend/com.acm.snapshot_host.json` it will attempt to execute
    `backend/native_host.py`. This script contains a shebang pointing at
    the virtual environment interpreter.
  - The script is responsible for
    communicating with the extension via stdin/stdout.
  - Commands are held in an async FIFO queue inside the process. A
    post to `/snapshot` enqueues a request and suspends until the
    extension replies; the host thread pulls commands from the queue,
    sends them to the extension over native messaging, and fulfils the
    awaiting HTTP future when the response arrives.

- **Extension**:
  - Plain MV3 manifest (`extension/manifest.json`) with `scripting`, `tabs`, `activeTab` and `nativeMessaging` permissions.
  - Background script (`extension/src/background.ts`) written in TypeScript.
    - connects to the native host and listens for commands
    - uses `chrome.scripting.executeScript()` to evaluate `document.documentElement.outerHTML`

---

## Setup Instructions

1. **Build and load the extension**:

   ```bash
   cd extension
   npm install
   npm run build
   ```

   Load `extension/dist/` (containing `manifest.json`) as an unpacked extension in Chrome.
   Copy the extension ID shown in `chrome://extensions`.

2. **Install Python deps and register native messaging host (macOS + Google Chrome)**:

   ```bash
   ./scripts/install_macos_chrome.sh <extension_id>
   ```

   `backend/com.acm.snapshot_host.json` is a template committed to the repo.
   The install script generates the real native messaging host manifest and writes it to:
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.acm.snapshot_host.json`
   so Chrome can launch the native host and allow the installed extension to connect.

   This script:
   - creates `backend/.venv` using `uv` and installs `backend/requirements.txt`
   - installs a wrapper executable under `~/.local/bin/`
   - writes the native messaging manifest to Chrome's NativeMessagingHosts directory

   On Linux, use:

   ```bash
   ./scripts/install_linux_chrome.sh <extension_id>
   ```

   If you're using Chromium instead of Google Chrome, pass `--chromium` as a second argument.

3. **Run the backend**:

   ```bash
   cd backend
   source ./.venv/bin/activate
   fastapi dev app.py
   ```

4. **Trigger a snapshot**:
   ```bash
   curl -X POST http://127.0.0.1:8000/snapshot
   ```
   The command will block until the extension returns HTML; the response body
   contains the page markup and the backend log will also record the length.

---

## Notes

- The current implementation uses in‑memory storage for commands.
- Communication between the native host and the backend is unsecured.
