import { createCanvas as createNodeCanvas } from "canvas";

// Low-level Canvas implementation for Node.js.
// This file knows nothing about WebRedact detection.
// It only applies already-detected boxes.

export function createCanvas(width, height) {
  if (!Number.isInteger(width) || width <= 0) {
    throw new TypeError("Canvas width must be a positive integer.");
  }

  if (!Number.isInteger(height) || height <= 0) {
    throw new TypeError("Canvas height must be a positive integer.");
  }

  // Replaces document.createElement("canvas")
  const canvas = createNodeCanvas(width, height);
  return canvas;
}

export function drawSource(canvas, source) {
  // Removed willReadFrequently as it is a browser-only optimization hint
  const ctx = canvas.getContext("2d", {
    alpha: false
  });

  if (!ctx) {
    throw new Error("Unable to create 2D canvas context.");
  }

  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  return ctx;
}

function getRedactionLabel(box, options = {}) {
  if (box.label) {
    return String(box.label);
  }

  if (options.showDefaultLabel === false) {
    return "";
  }

  return "REDACTED";
}

function drawRedactionLabel(ctx, box, options = {}) {
  const label = getRedactionLabel(box, options);
  if (!label) return;

  const minDimension = Math.min(box.width, box.height);

  // Keep the text readable without overwhelming small redaction boxes.
  let fontSize = Math.max(
    10,
    Math.min(
      options.fontSize ?? 16,
      Math.floor(minDimension * 0.45)
    )
  );

  // If the box is wider than it is tall, the font can be somewhat larger.
  if (box.height >= 24) {
    fontSize = Math.min(fontSize, Math.floor(box.height * 0.55));
  }

  ctx.save();

  ctx.fillStyle = options.textColor ?? "#FFFFFF";
  ctx.font = `600 ${fontSize}px Arial, sans-serif`;
  ctx.textBaseline = "middle";

  const maxTextWidth = Math.max(10, box.width - 12);
  let text = label;

  // Fit label inside the redaction box.
  while (
    text.length > 1 &&
    ctx.measureText(text).width > maxTextWidth
  ) {
    text = text.slice(0, -2) + "…";
  }

  const textWidth = ctx.measureText(text).width;

  // Center horizontally and vertically.
  const textX = box.x + Math.max(6, (box.width - textWidth) / 2);
  const textY = box.y + box.height / 2;

  ctx.fillText(text, textX, textY);

  ctx.restore();
}

export function applyBlackout(ctx, box, options = {}) {
  ctx.save();

  // Explicitly use opaque black.
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000000";

  ctx.fillRect(
    box.x,
    box.y,
    box.width,
    box.height
  );

  drawRedactionLabel(ctx, box, options);

  ctx.restore();
}

export function applyBlur(ctx, box, radius = 18, options = {}) {
  ctx.save();

  // WARNING: node-canvas does not natively support ctx.filter = 'blur()' 
  // It will likely fail silently and just draw a clear image.
  // If blur is strictly required, you will need to implement a manual pixel-manipulation blur or rely on 'sharp'.
  ctx.filter = `blur(${radius}px)`;

  const padding = radius * 2;

  ctx.drawImage(
    ctx.canvas,
    box.x - padding,
    box.y - padding,
    box.width + padding * 2,
    box.height + padding * 2,
    box.x - padding,
    box.y - padding,
    box.width + padding * 2,
    box.height + padding * 2
  );

  ctx.restore();

  // A label can optionally be drawn over a blur as well.
  if (options.showLabelOnBlur) {
    ctx.save();
    drawRedactionLabel(ctx, box, options);
    ctx.restore();
  }
}

export function applyBox(ctx, box, options = {}) {
  const type = box.type || "blackout";

  switch (type) {
    case "blackout":
      applyBlackout(ctx, box, options);
      break;

    case "blur":
      applyBlur(
        ctx,
        box,
        options.blurRadius ?? 18,
        options
      );
      break;

    default:
      throw new Error(
        `Unsupported redaction type: ${type}`
      );
  }
}

export function applyRedactionBoxes(
  ctx,
  boxes,
  options = {}
) {
  for (const box of boxes) {
    applyBox(ctx, box, options);
  }
}