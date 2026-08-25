/**
 * offscreen.js
 *
 * Runs inside the offscreen document, not the service worker. This is the
 * one piece of the pipeline that CANNOT run in background.js: ONNX Runtime
 * Web's wasm backend performs a dynamic import() at load time, and the
 * HTML spec forbids dynamic import() inside ServiceWorkerGlobalScope
 * (https://github.com/w3c/ServiceWorker/issues/1356). An offscreen
 * document is a real window context, so it doesn't have that restriction.
 *
 * background.js creates this document on demand, sends it the screenshot,
 * and gets back just the detection boxes. Everything else (drawing the
 * redaction boxes, saving to Downloads) still happens in background.js.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== "offscreen" || message.action !== "detect_pii_offscreen") {
        return false; // not addressed to us; let other listeners handle it
    }

    (async () => {
        try {
            const detections = await detectPII(message.imgSrc, message.options || {});
            sendResponse({ success: true, detections });
        } catch (error) {
            console.error("Offscreen PII detection error:", error);
            sendResponse({ success: false, error: String(error) });
        }
    })();

    return true; // keep the message channel open for the async sendResponse
});
