// NOTE: onnxruntime-web is no longer imported here. Its wasm backend does a
// dynamic import() internally, which the HTML spec disallows inside a
// service worker (ServiceWorkerGlobalScope). Model inference instead runs
// in offscreen.html/offscreen.js, a real DOM window context created on
// demand via chrome.offscreen — see ensureOffscreenDocument() below.

async function resizeImageDataUrl(dataUrl, targetSize = 640, backgroundColor = null) {
    const blob = dataUrlToBlob(dataUrl);
    const bitmap = await createImageBitmap(blob);

    // Scale to fit entirely within targetSize x targetSize (no cropping)
    const scale = Math.min(targetSize / bitmap.width, targetSize / bitmap.height);
    const newWidth = Math.round(bitmap.width * scale);
    const newHeight = Math.round(bitmap.height * scale);
    const offsetX = Math.floor((targetSize - newWidth) / 2);
    const offsetY = Math.floor((targetSize - newHeight) / 2);

    const canvas = new OffscreenCanvas(targetSize, targetSize);
    const ctx = canvas.getContext("2d");

    // Fill background so the un-covered area (letterbox bars) isn't transparent/garbage.
    // Set backgroundColor to null if you want a transparent PNG instead.
    if (backgroundColor) {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, targetSize, targetSize);
    }

    ctx.drawImage(bitmap, offsetX, offsetY, newWidth, newHeight);
    bitmap.close();

    const outBlob = await canvas.convertToBlob({ type: "image/png" });
    const arrayBuffer = await outBlob.arrayBuffer();
    return `data:image/png;base64,${arrayBufferToBase64(arrayBuffer)}`;
}

function dataUrlToBlob(dataUrl) {
    const commaIndex = dataUrl.indexOf(",");
    const header = dataUrl.slice(0, commaIndex);
    const base64 = dataUrl.slice(commaIndex + 1);
    const mimeMatch = header.match(/data:([^;]+);base64/);
    const mime = mimeMatch ? mimeMatch[1] : "image/png";

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}

// OffscreenCanvas has no toDataURL(), so we base64-encode the blob's bytes manually.
function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // avoid call-stack limits on String.fromCharCode
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// Draws solid black boxes over each detection's region on top of the
// ORIGINAL (non-letterboxed) image. detections[].box coordinates are
// already mapped back to this image's pixel space by detectPII(), so no
// additional scaling is needed here.
async function drawRedactedImage(dataUrl, detections) {
    const blob = dataUrlToBlob(dataUrl);
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    ctx.fillStyle = "black";
    for (const det of detections) {
        const { x1, y1, x2, y2 } = det.box;
        const x = Math.max(0, Math.min(x1, x2));
        const y = Math.max(0, Math.min(y1, y2));
        const w = Math.min(Math.abs(x2 - x1), canvas.width - x);
        const h = Math.min(Math.abs(y2 - y1), canvas.height - y);
        ctx.fillRect(x, y, w, h);
    }

    const outBlob = await canvas.convertToBlob({ type: "image/png" });
    const arrayBuffer = await outBlob.arrayBuffer();
    return `data:image/png;base64,${arrayBufferToBase64(arrayBuffer)}`;
}

// Saves a data URL to disk via the chrome.downloads API (lands in the
// user's Downloads folder, or wherever Chrome is configured to save to).
// Requires the "downloads" permission in manifest.json.
function saveImageLocally(dataUrl, filenamePrefix = "redacted") {
    return new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        chrome.downloads.download(
            {
                url: dataUrl,
                filename: `${filenamePrefix}_${timestamp}.png`,
                saveAs: false,
                conflictAction: "uniquify"
            },
            (downloadId) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(downloadId);
            }
        );
    });
}

// ============================
// OFFSCREEN DOCUMENT (for model inference)
// ============================
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreenDocument = null; // guards against a race if multiple detections fire close together

async function hasOffscreenDocument() {
    // chrome.runtime.getContexts requires Chrome 116+. If it's unavailable,
    // fall back to assuming no document exists yet (createDocument below
    // will just throw "already exists" in that edge case, which is caught).
    if (!chrome.runtime.getContexts) return false;
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    return existingContexts.length > 0;
}

async function ensureOffscreenDocument() {
    if (await hasOffscreenDocument()) return;

    if (creatingOffscreenDocument) {
        await creatingOffscreenDocument;
        return;
    }

    creatingOffscreenDocument = chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["WORKERS"],
        justification:
            "Run ONNX Runtime Web model inference; its wasm backend uses dynamic import(), which is disallowed inside a service worker."
    });

    try {
        await creatingOffscreenDocument;
    } catch (err) {
        // Someone else may have created it in a race; only rethrow if it's
        // not the expected "already exists" case.
        if (!String(err).includes("Only a single offscreen")) throw err;
    } finally {
        creatingOffscreenDocument = null;
    }
}

async function runDetectionInOffscreen(imgSrc, options) {
    await ensureOffscreenDocument();
    return chrome.runtime.sendMessage({
        target: "offscreen",
        action: "detect_pii_offscreen",
        imgSrc,
        options
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // ============================
    // TAKE SCREENSHOT
    // ============================
    if (request.action === "take_screenshot") {

        setTimeout(() => {

            chrome.tabs.captureVisibleTab(
                null,
                { format: "png" },
                async (dataUrl) => {

                    if (!dataUrl) {
                        sendResponse({
                            success: false,
                            error: "Screenshot capture returned no data"
                        });
                        return;
                    }

                    try {
                        const resizedDataUrl = await resizeImageDataUrl(dataUrl);
                        sendResponse({ success: true, imgSrc: resizedDataUrl });

                    } catch {
                        sendResponse({
                            success: true,
                            imgSrc: dataUrl
                        });
                    }

                }
            );

        }, 150);

        return true;
    }


    // ============================
    // SEND TO BACKEND
    // ============================
    if (request.action === "send_to_backend") {

        const backendUrl = "http://localhost:3000/api/data";
        const TIMEOUT_MS = 8000; // fail fast instead of hanging forever if the backend never responds

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        fetch(backendUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(request.payload),
            signal: controller.signal
        })
            .then(function(response) {

                if (!response.ok) {
                    throw new Error(
                        "Backend returned HTTP " + response.status
                    );
                }

                sendResponse({
                    success: true
                });

            })
            .catch(function(error) {

                // AbortController throws a DOMException named "AbortError" on timeout;
                // surface that distinctly so it's obvious in logs/UI that it timed out
                // rather than being rejected or erroring some other way.
                const isTimeout = error && error.name === "AbortError";
                const message = isTimeout
                    ? `Backend request timed out after ${TIMEOUT_MS}ms (is something listening on ${backendUrl}?)`
                    : String(error);

                console.error("Backend error:", message);

                sendResponse({
                    success: false,
                    error: message
                });

            })
            .finally(function() {
                clearTimeout(timeoutId);
            });

        return true;
    }


    // ============================
    // DETECT PII
    // ============================
    if (request.action === "detect_pii") {

        (async () => {
            try {
                let imgSrc = request.imgSrc;

                // If no image was handed to us, capture the current tab fresh.
                if (!imgSrc) {
                    imgSrc = await new Promise((resolve, reject) => {
                        chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
                            if (!dataUrl) {
                                reject(new Error("Screenshot capture returned no data"));
                                return;
                            }
                            resolve(dataUrl);
                        });
                    });
                }

                // NOTE: pass the ORIGINAL (non-letterboxed) image here — detectPII
                // does its own internal letterbox to 640x640 and returns box
                // coordinates already mapped back to this image's real pixel space.
                // Do not pre-resize with resizeImageDataUrl() first, or detections
                // will be double-letterboxed and the returned coordinates will be wrong.
                const offscreenResult = await runDetectionInOffscreen(imgSrc, request.options || {});
                if (!offscreenResult || !offscreenResult.success) {
                    throw new Error(
                        (offscreenResult && offscreenResult.error) || "Offscreen detection failed with no error detail"
                    );
                }
                const detections = offscreenResult.detections;

                // Save a redacted copy locally (PII regions blacked out).
                // This is best-effort: a save failure shouldn't fail the whole
                // detection response, since the caller likely still wants the
                // detection boxes even if the download couldn't be written.
                let downloadId = null;
                let saveError = null;
                try {
                    const redactedDataUrl = await drawRedactedImage(imgSrc, detections);
                    downloadId = await saveImageLocally(redactedDataUrl);
                } catch (err) {
                    console.error("Failed to save redacted image:", err);
                    saveError = String(err);
                }

                sendResponse({ success: true, detections, downloadId, saveError });

            } catch (error) {
                console.error("PII detection error:", error);
                sendResponse({
                    success: false,
                    error: String(error)
                });
            }
        })();

        return true; // keep the message channel open for the async sendResponse
    }


    // ============================
    // UNKNOWN ACTION
    // ============================
    sendResponse({
        success: false,
        error: "Unknown action: " + request.action
    });

    return false;
});
