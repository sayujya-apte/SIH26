// Node.js image loading helper
import { Image } from "canvas";

export function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => resolve(img);
    img.onerror = (err) =>
      reject(new Error(`Unable to decode image. ${err ? err.message : ""}`));

    if (typeof source === "string") {
      // 1. If it includes the Data URI prefix, assign it directly
      if (source.startsWith("data:image")) {
        img.src = source;
      } else {
        // 2. If it is a raw Base64 string, convert it to a Buffer
        img.src = Buffer.from(source, "base64");
      }
      return;
    }

    // Fallback: Also accept a Buffer if you pre-processed it elsewhere
    if (Buffer.isBuffer(source)) {
      img.src = source;
      return;
    }

    reject(new TypeError("Image source must be a Base64 string or Buffer."));
  });
}
// Node.js export helper (Using Buffers instead of Blobs)
export async function canvasToBuffer(canvas, type = "image/png", config) {
  return new Promise((resolve, reject) => {
    try {
      // node-canvas uses .toBuffer with a callback for async execution
      canvas.toBuffer((err, buffer) => {
        if (err) {
          reject(new Error("Canvas export failed."));
          return;
        }
        resolve(buffer);
      }, type, config);
    } catch (error) {
      reject(error);
    }
  });
}

// Alias to maintain compatibility with your existing redaction-engine imports
export const canvasToBlob = canvasToBuffer;

export async function imageSourceToBitmap(source) {
  // Node.js doesn't have `createImageBitmap`. 
  // Fortunately, node-canvas's ctx.drawImage() works perfectly with the Image instances returned by loadImage.
  return loadImage(source);
}

export function closeBitmap(bitmap) {
  // Manual memory management isn't strictly required like in the browser,
  // but clearing the source helps the Node.js Garbage Collector free up memory faster.
  if (bitmap && bitmap.src) {
    bitmap.src = "";
  }
}