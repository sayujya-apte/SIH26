// Convert the data url to a png file
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

// Draws solid black boxes over each detection's region on top of the original image. 
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

// Saves redacted image png as a file to Downloads.
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

// Saves text content as a file to Downloads.
function saveTextLocally(text, filenamePrefix = "moondream_response") {
    return new Promise((resolve, reject) => {
        console.log("[Moondream] Saving response to Downloads...");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const base64 = btoa(unescape(encodeURIComponent(text)));
        const dataUrl = `data:text/plain;base64,${base64}`;
        chrome.downloads.download(
            {
                url: dataUrl,
                filename: `${filenamePrefix}_${timestamp}.txt`,
                saveAs: false,
                conflictAction: "uniquify"
            },
            (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error("[Moondream] Download failed:", chrome.runtime.lastError.message);
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                console.log("[Moondream] Download successful, ID:", downloadId);
                resolve(downloadId);
            }
        );
    });
}

// Calls Moondream API with the redacted image (base64) and returns the response
async function callMoondreamApi(base64Png, userPrompt) {
    const apiKey = ""; // [[API_KEY_HERE]]
    if (!apiKey) {
        throw new Error("Moondream API key not configured");
    }

    const imageDataUrl = `data:image/png;base64,${base64Png}`;

    const systemPrompt = [
        "You are the reasoning layer of a privacy-preserving browser agent. Your only",
        "input is a screenshot of the current webpage, with sensitive regions (passwords,",
        "personal data, faces, etc.) blacked out before it ever reached you. You have no",
        "access to the DOM, HTML, or any element metadata — everything you know about the",
        "page comes from visually interpreting this single image.",
        "",
        "Your task: given the user's goal and this screenshot, identify the next single",
        "browser action needed to make progress, by visually locating the relevant UI",
        "element (button, input field, link, etc.) yourself.",
        "",
        "Rules:",

        "1. Base every decision purely on what is visible in the image. Do not assume",
        "elements exist off-screen or outside the image bounds.",

        "2. Treat every blacked-out region as permanently opaque. Never guess, infer, or",
        "hallucinate what might be underneath it.",

        "3. If the action needed requires interacting with a redacted region (e.g. typing",
        "into a hidden password field), do not attempt it — instead return an action",
        "indicating the user must handle that step manually.",

        "4. Return pixel coordinates for the center of the target element as it appears",
        "in the provided image.",

        "5. If the goal already appears complete based on the current screenshot, return",
        "\"done\".",

        "",

        "Output strictly as JSON, nothing else:",

        "",
        "{",
        "\"action\": \"click\" | \"type\" | \"scroll\" | \"navigate\" | \"request_user_input\" | \"done\",",
        "\"coordinates\": {\"x\": <int>, \"y\": <int>} | null,",
        "\"value\": string | null,",
        "\"confidence\": \"high\" | \"medium\" | \"low\",",
        "\"reasoning\": string",
        "}"
    ].join("\n");

    const response = await fetch(
        "https://api.moondream.ai/v1/chat/completions",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "moondream3.1-9B-A2B",
                messages: [
                    {
                        role: "system",
                        content: [
                            {
                                type: "text",
                                text: systemPrompt
                            }
                        ]
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: userPrompt || "Identify the next action needed based on this screenshot."
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: imageDataUrl
                                }
                            }
                        ]
                    }
                ]
            })
        }
    );

    console.log("[Moondream] HTTP status:", response.status);

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("[Moondream] Error response:", errorData);
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log("[Moondream] Parsed response:", data);
    return data;
}

// OFFSCREEN DOCUMENT (for model inference)
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreenDocument = null;

async function hasOffscreenDocument() {
    
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
                        sendResponse({ success: true, imgSrc: dataUrl });

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

    if (request.action === "detect_pii") {

        (async () => {
            try {
                let imgSrc = request.imgSrc;

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
                const offscreenResult = await runDetectionInOffscreen(imgSrc, request.options || {});
                if (!offscreenResult || !offscreenResult.success) {
                    throw new Error(
                        (offscreenResult && offscreenResult.error)
                    );
                }
                const detections = offscreenResult.detections;
                const userPrompt = request.userPrompt || "Identify the next action needed based on this screenshot.";

                // Save a redacted copy locally (PII regions blacked out).
                let downloadId = null;
                let saveError = null;
                let redactedDataUrl = null;
                try {
                    redactedDataUrl = await drawRedactedImage(imgSrc, detections);
                    downloadId = await saveImageLocally(redactedDataUrl);
                } catch (err) {
                    console.error("Failed to save redacted image:", err);
                    saveError = String(err);
                }

                // Call Moondream API with the redacted image and user prompt
                let moondreamResponse = null;
                let moondreamError = null;
                if (redactedDataUrl) {
                    try {
                        const apiResponse = await callMoondreamApi(redactedDataUrl, userPrompt);
                        moondreamResponse = apiResponse;
                        await saveTextLocally(JSON.stringify(apiResponse, null, 2));
                    } catch (err) {
                        console.error("Moondream API error:", err);
                        moondreamError = String(err);
                    }
                } else {
                    console.log("[Moondream] No redactedDataUrl available, skipping API call");
                }

                sendResponse({ success: true, detections, downloadId, saveError, moondreamResponse, moondreamError });

            } catch (error) {
                console.error("PII detection error:", error);
                sendResponse({
                    success: false,
                    error: String(error)
                });
            }
        })();

        return true;
    }

    sendResponse({
        success: false,
        error: "Unknown action: " + request.action
    });

    return false;
});

// Inject content script and CSS when toolbar icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => !!document.getElementById('my-chatbot-sidebar')
        });

        const alreadyInjected = results?.[0]?.result === true;

        if (alreadyInjected) {
            chrome.tabs.sendMessage(tab.id, { action: 'toggle_sidebar' });
        } else {
            await chrome.scripting.insertCSS({
                target: { tabId: tab.id },
                files: ["style.css"]
            });
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"]
            });
        }
    } catch (err) {
        console.error("Failed to inject content script:", err);
    }
});
