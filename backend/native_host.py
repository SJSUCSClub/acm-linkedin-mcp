#!/absolute/path/to/.venv/bin/python3
"""Native messaging host that polls the FastAPI backend for commands.

This version uses the HTTP queue endpoints defined in `app.py`.  It is
intended to be run either manually during development (to see logs) or by
Chrome when the extension connects via
`chrome.runtime.connectNative('com.acm.snapshot_host')`.

The loop is simple:

  1. GET /command -> {id: <uuid> | None}
  2. If id present, send native message {command:'snapshot',id} to
     extension via stdout.
  3. Read a message from stdin (should be a snapshotResult with the same
     id).  POST /response with id/html back to backend.
  4. Repeat every second.
"""

import sys
import struct
import json
import time
import httpx
import logging
import os

LOG_DIR = os.path.join(os.path.dirname(__file__), "..", "log")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    filename=os.path.join(LOG_DIR, "native_host.log"),
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    filemode='w' # 'a' for append (default), 'w' for overwrite
)


BACKEND_COMMAND = "http://localhost:8000/command"
BACKEND_RESPONSE = "http://localhost:8000/response"


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len:
        return None
    msg_len = struct.unpack("=I", raw_len)[0]
    data = sys.stdin.buffer.read(msg_len)
    if not data:
        return None
    return json.loads(data.decode("utf-8"))


def send_message(msg: dict):
    encoded = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def main():
    logging.info("[host] http-polling native host started")
    while True:
        try:
            r = httpx.get(BACKEND_COMMAND, timeout=5.0)
            if r.status_code == 200:
                obj = r.json()
                req_id = obj.get("id")
                if req_id:
                    logging.info(f"[host] dispatching id={req_id}")
                    send_message({"command": "snapshot", "id": req_id})
                    resp = read_message()
                    if resp and resp.get("type") == "snapshotResult":
                        html = resp.get("html", "")
                        logging.info(f"[host] forwarding {req_id} and html of length {len(html)}")
                        httpx.post(BACKEND_RESPONSE, json={"id": req_id, "html": html})
                        logging.info(f"[host] forwarded snapshot id={req_id}")
        except Exception as exc:  # keep running
            logging.info(f"[host] error: {exc}")
        time.sleep(1)


if __name__ == "__main__":
    main()
