/// <reference types="chrome" />

// background script for the extension. communicates with the native host and
// uses the chrome.debugger API to inspect and interact with the active tab.

console.log("[extension] background starting");

let nativePort: chrome.runtime.Port | null = null;

function connectToNativeHost() {
  try {
    nativePort = chrome.runtime.connectNative("com.acm.snapshot_host");
    nativePort.onMessage.addListener(onNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      console.warn("[extension] native host disconnected");
      nativePort = null;
      setTimeout(connectToNativeHost, 5000);
    });
    console.log("[extension] connected to native host");
  } catch (err) {
    console.error("[extension] failed to connect to native host", err);
    setTimeout(connectToNativeHost, 5000);
  }
}

function onNativeMessage(msg: any) {
  console.log("[extension] native message", msg);
  if (msg.command === "snapshot") {
    captureSnapshot(msg.id);
  }
}

function sendSnapshotResult(requestId: string | undefined, html: string) {
  if (!requestId) {
    console.warn("[extension] missing requestId; cannot send snapshotResult");
    return;
  }
  nativePort?.postMessage({ type: "snapshotResult", id: requestId, html });
}

async function evaluateOuterHtml(tabId: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.documentElement.outerHTML,
  });
  const first = results[0];
  const html = (first?.result as string | undefined) ?? "";
  return html;
}

// TODO: this is just an example
// you will want to change it so that it can query specific
// tabs and not just take the first one
async function captureSnapshot(requestId?: string) {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab || tab.id == null) {
      console.warn("[extension] no tabs found to capture snapshot");
      sendSnapshotResult(requestId, "");
      return;
    }

    // avoid chrome:// URLs which the debugger cannot access
    if (tab.url && tab.url.startsWith("chrome://")) {
      console.warn("[extension] privileged tab, skipping snapshot", tab.url);
      sendSnapshotResult(requestId, "");
      return;
    }

    console.info("[extension] capturing snapshot of tab", tab.id, tab.url);
    const html = await evaluateOuterHtml(tab.id);
    console.log("[extension] snapshotResult was", html);
    sendSnapshotResult(requestId, html);
  } catch (err) {
    console.error("[extension] captureSnapshot error", err);
    sendSnapshotResult(requestId, "");
  }
}

// initialize
connectToNativeHost();
