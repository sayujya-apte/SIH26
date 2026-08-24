// Public high-level API.
//
// This is the file your extension should import.
//
// Input:
//   screenshot: Blob | data URL
//   boxes: [{x,y,width,height,type,id,label}]
//
// Output:
//   {blob, dataUrl, width, height, boxes, metadata}

import {
  normalizeBoxes,
  normalizedBoxesToPixels,
  scaleBoxes
} from "./box-utils.js";

import {
  loadImage,
  canvasToBlob
} from "./image-utils.js";

import {
  createCanvas,
  drawSource,
  applyRedactionBoxes
} from "./canvas-redactor.js";

/**
 * Redact a screenshot using pixel-coordinate boxes.
 *
 * Coordinates must correspond to the image's pixel dimensions.
 * Optional `label` is rendered in white on top of the blackout,
 * e.g. `label: "password redacted"`.
 */
export async function redactScreenshot(
  screenshot,
  boxes,
  options = {}
) {
  const outputType = options.outputType || "image/png";
  const outputQuality = options.quality;

  const image = await loadImage(screenshot);

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!width || !height) {
    throw new Error("Screenshot has invalid dimensions.");
  }

  const normalized = normalizeBoxes(
    boxes,
    width,
    height
  );

  const canvas = createCanvas(width, height);
  const ctx = drawSource(canvas, image);

  applyRedactionBoxes(
    ctx,
    normalized,
    {
      blurRadius: options.blurRadius
    }
  );

  const blob = await canvasToBlob(
    canvas,
    outputType,
    outputQuality
  );

  const dataUrl = options.includeDataUrl
    ? canvas.toDataURL(outputType, outputQuality)
    : null;

  return {
    blob,
    dataUrl,
    width,
    height,
    boxes: normalized,
    metadata: {
      redacted: true,
      redactionCount: normalized.length,
      outputType,
      timestamp: Date.now()
    }
  };
}

/**
 * Redact a screenshot when detector coordinates are normalized
 * to [0,1].
 */
export async function redactNormalizedScreenshot(
  screenshot,
  normalizedBoxes,
  options = {}
) {
  const image = await loadImage(screenshot);

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const pixelBoxes = normalizedBoxesToPixels(
    normalizedBoxes,
    width,
    height
  );

  return redactScreenshot(
    image,
    pixelBoxes,
    options
  );
}

/**
 * Convert boxes from one image coordinate system to another.
 *
 * Useful if WebRedact ran against a resized screenshot.
 */
export function convertBoxCoordinates(
  boxes,
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight
) {
  return scaleBoxes(
    boxes,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight
  );
}

/**
 * Merge boxes from multiple detectors.
 *
 * Example:
 *   mergeRedactionBoxes(webRedactBoxes, domBoxes)
 */
export function mergeRedactionBoxes(...boxLists) {
  const merged = [];

  for (const list of boxLists) {
    if (!Array.isArray(list)) continue;

    for (const box of list) {
      if (!box || typeof box !== "object") continue;
      merged.push({ ...box });
    }
  }

  return merged;
}
