// Resizes a data URL image to targetSize x targetSize WITHOUT cropping.
// The image is scaled down to fit inside the square (preserving aspect ratio)
// and centered on a background (letterboxed), so nothing is cut off.
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

// Decodes a "data:<mime>;base64,<data>" string into a Blob without using fetch(),
// since fetch() on data: URLs is unreliable inside MV3 service workers.
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

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("https://chrome.google.com/webstore")) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "toggle_sidebar" });
  } catch (error) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    chrome.tabs.sendMessage(tab.id, { action: "toggle_sidebar" });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Handle Screenshot
  if (request.action === "take_screenshot") {
    setTimeout(() => {
      chrome.tabs.captureVisibleTab(null, { format: "png" }, async (dataUrl) => {
        try {
          console.log("[screenshot] original size (base64 chars):", dataUrl.length);
          const resizedDataUrl = await resizeImageDataUrl(dataUrl);
          console.log("[screenshot] resized size (base64 chars):", resizedDataUrl.length);
          sendResponse({ imgSrc: resizedDataUrl });
        } catch (error) {
          console.error("[screenshot] Error resizing screenshot, falling back to original:", error);
          sendResponse({ imgSrc: dataUrl });
        }
      });
    }, 150);
    return true;
  }

  // 2. Handle Backend POST Request
  // 2. Handle Backend POST Request
  if (request.action === "send_to_backend") {
    // Point this to your locally running Express server
    const backendUrl = "http://localhost:3000/api/data";

    fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      // The payload contains the text input and the base64 image data
      body: JSON.stringify(request.payload)
    })
      // ... rest of your fetch logic
      .then(response => {
        console.log("Successfully sent to backend");
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error("Error sending to backend:", error);
        sendResponse({ success: false, error: error.toString() });
      });

    return true; // Keeps the message channel open for the async fetch response
  }
});