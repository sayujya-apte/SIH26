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
            sendResponse({success: true, imgSrc: resizedDataUrl});

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

    fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request.payload)
    })
      .then(function (response) {

        if (!response.ok) {
          throw new Error(
            "Backend returned HTTP " + response.status
          );
        }

        sendResponse({
          success: true
        });

      })
      .catch(function (error) {

        console.error("Backend error:", error);

        sendResponse({
          success: false,
          error: String(error)
        });

      });

    return true;
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