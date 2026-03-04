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
  - Plain MV3 manifest (`extension/manifest.json`) with `debugger`, `tabs`, `activeTab` and `nativeMessaging` permissions.
  - Background script (`extension/src/background.ts`) written in TypeScript.
    - connects to the native host and listens for commands
    - attaches to the active tab using the `chrome.debugger` API
    - evaluates `document.documentElement.outerHTML` (or any arbitrary DevTools command) and returns the result
    - detaches once snapshot is obtained; the open debugger session can later be reused for clicks or other interactions.

---

## Setup Instructions

1. **Install Python dependencies** (inside `backend/`):

   ```bash
   uv venv --python=3.12 ./.venv
   source ./.venv/bin/activate
   uv pip install -r requirements.txt
   ```

2. **Register native messaging host** (Linux example):

   ```bash
   mkdir -p ~/.config/google-chrome/NativeMessagingHosts
   cp backend/com.acm.snapshot_host.json ~/.config/google-chrome/NativeMessagingHosts/
   # edit the file and replace:
   #   - "path" with the absolute path to backend/native_host.py
   #     (this script polls the HTTP queue and logs to stderr)
   #   - "__EXTENSION_ID__" with the ID of the unpacked extension
   chmod +x backend/native_host.py
   ```

   During development you can view the logs in the log file (`log/native_host.log`):

3. **Run the backend**:

   ```bash
   cd backend
   fastapi dev app.py
   ```

4. **Build and load the extension**:

   ```bash
   cd extension
   npm install
   npm run build
   ```

   Load the `extension/` folder (containing `manifest.json`) as an unpacked extension in Chrome. The compiled `background.js` will appear next to the manifest.

5. **Trigger a snapshot**:
   ```bash
   curl -X POST http://localhost:8000/snapshot
   ```
   The command will block until the extension returns HTML; the response body
   contains the page markup and the backend log will also record the length.

---

## Notes

- The current implementation uses in‑memory storage for commands.
- Communication between the native host and the backend is unsecured.
