"""
FastAPI application and native messaging host unified in a single
process.

When started by Chrome as a native messaging host the script will:

  * spawn a background thread reading messages from stdin and handling
    snapshot results from the extension
  * run an asyncio task that polls `current_command` and dispatches
    commands to the extension via stdout
  * still expose the familiar HTTP endpoints so other clients can trigger
    snapshots, inspect state, or receive snapshots directly if desired

In normal development/operation you can also start the HTTP server with
`uvicorn backend.app:app --reload`.
"""

import asyncio
import uuid

from fastapi import FastAPI
from pydantic import BaseModel
from contextlib import asynccontextmanager


@asynccontextmanager
async def startup_event(app: FastAPI):
    global loop, command_queue
    # remember event loop for thread callbacks and create our queue
    loop = asyncio.get_running_loop()
    command_queue = asyncio.Queue()
    yield
    

app = FastAPI(lifespan=startup_event)

# simple FIFO queue of pending snapshot request IDs.  Each ID is paired
# with a Future in `pending_futures` that will be completed when the
# extension returns the HTML.
command_queue: asyncio.Queue[str] | None = None
pending_futures: dict[str, asyncio.Future[str]] = {}


# the asyncio event loop used by the reader thread to deliver results
loop: asyncio.AbstractEventLoop | None = None


@app.get("/")
def read_root():
    return {"Hello": "World"}

# --- native messaging support ------------------------------------------------

class Command(BaseModel):
    command: str | None = None

class SnapshotResponse(BaseModel):
    id: str
    html: str


# endpoint used by the native host to poll for the next pending
# snapshot request.  Returns an id or null when the queue is empty.
@app.get("/command")
async def get_command():
    if not command_queue:
        return {"id": None}
    try:
        req_id = command_queue.get_nowait()
    except asyncio.QueueEmpty:
        return {"id": None}
    return {"id": req_id}


@app.post("/snapshot")
async def snapshot_request():
    """
    Client-facing API that requests a snapshot and returns the HTML.

    A unique ID is created and enqueued; the handler then awaits the
    corresponding future which will be fulfilled by `/response` (called by
    the native host once it has forwarded the extension's reply).
    """
    if not command_queue or not loop:
        raise RuntimeError("server not initialized")
    req_id = str(uuid.uuid4())
    fut: asyncio.Future[str] = loop.create_future()  # type: ignore
    pending_futures[req_id] = fut
    await command_queue.put(req_id)  # type: ignore
    html = await fut
    pending_futures.pop(req_id, None)
    return {"html": html}


@app.post("/response")
async def snapshot_response(response: SnapshotResponse):
    """
    Endpoint called by the native host after it receives HTML from the
    extension.  The body must include the original request id so the
    corresponding future can be resolved.
    """
    id = response.id
    html = response.html
    fut = pending_futures.pop(id, None)
    if fut:
        fut.set_result(html)
        return {"status": "ok"}
    return {"status": "missing", "id": id}
