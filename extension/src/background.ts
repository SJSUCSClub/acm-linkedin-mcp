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

function attachAndRun(tabId: number): Promise<void> {
  const debuggee: chrome.debugger.Debuggee = { tabId };
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(debuggee, "1.3", () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function detach(tabId: number): Promise<void> {
  const debuggee: chrome.debugger.Debuggee = { tabId };
  return new Promise((resolve) => {
    chrome.debugger.detach(debuggee, () => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[extension] debugger detach error",
          chrome.runtime.lastError.message,
        );
      } else {
        console.log("[extension] debugger detached from tab", tabId);
      }
      resolve();
    });
  });
}

// TODO: this is just an example
// you will want to change it so that it can query specific
// tabs and not just take the first one
async function captureSnapshot(requestId?: string) {
  try {
    const tabs = await chrome.tabs.query({});
    let tab = tabs[0];
    if (!tab || tab.id == null) {
      console.warn("[extension] no tabs found to capture snapshot");
      return;
    }

    // avoid chrome:// URLs which the debugger cannot access
    if (tab.url && tab.url.startsWith("chrome://")) {
      console.warn("[extension] privileged tab, skipping snapshot", tab.url);
      nativePort?.postMessage({ type: "snapshotResult", html: "" });
      return;
    }

    console.info("[extension] capturing snapshot of tab", tab.id, tab.url);
    await attachAndRun(tab.id);

    const result: any = await new Promise((resolve) => {
      chrome.debugger.sendCommand(
        { tabId: tab.id! },
        "Runtime.evaluate",
        { expression: "document.documentElement.outerHTML" },
        resolve,
      );
    });

    const html = result?.result?.value || "";
    console.log("[extension] snapshotResult was", html);
    nativePort?.postMessage({ type: "snapshotResult", id: requestId, html });
    await detach(tab.id);
  } catch (err) {
    console.error("[extension] captureSnapshot error", err);
  }
}

// initialize
connectToNativeHost();
