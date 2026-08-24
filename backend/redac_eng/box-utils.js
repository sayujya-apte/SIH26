// Coordinate and validation utilities.

const DEFAULT_TYPE = "blackout";

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeBox(input, imageWidth, imageHeight) {
  if (!input || typeof input !== "object") {
    throw new TypeError("Redaction box must be an object.");
  }

  let x = input.x;
  let y = input.y;
  let width = input.width ?? input.w;
  let height = input.height ?? input.h;

  if (![x, y, width, height].every(finiteNumber)) {
    throw new TypeError(
      "Redaction box requires numeric x, y, width, and height."
    );
  }

  if (width < 0 || height < 0) {
    throw new RangeError(
      "Redaction box width/height cannot be negative."
    );
  }

  // Convert the box into image-space coordinates and clip it to the image.
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(imageWidth, x + width);
  const bottom = Math.min(imageHeight, y + height);

  const clippedWidth = Math.max(0, right - left);
  const clippedHeight = Math.max(0, bottom - top);

  return {
    id: input.id ?? null,
    x: left,
    y: top,
    width: clippedWidth,
    height: clippedHeight,
    type: input.type || DEFAULT_TYPE
  };
}

export function normalizeBoxes(boxes, imageWidth, imageHeight) {
  if (!Array.isArray(boxes)) {
    throw new TypeError("Redaction boxes must be an array.");
  }

  return boxes
    .map((box) => normalizeBox(box, imageWidth, imageHeight))
    .filter((box) => box.width > 0 && box.height > 0);
}

export function normalizedToPixels(
  box,
  imageWidth,
  imageHeight
) {
  if (
    !finiteNumber(box.x) ||
    !finiteNumber(box.y) ||
    !finiteNumber(box.width) ||
    !finiteNumber(box.height)
  ) {
    throw new TypeError("Normalized box must contain numeric values.");
  }

  if (
    box.x < 0 || box.x > 1 ||
    box.y < 0 || box.y > 1 ||
    box.width < 0 || box.width > 1 ||
    box.height < 0 || box.height > 1
  ) {
    throw new RangeError(
      "Normalized coordinates must be in the [0,1] range."
    );
  }

  return {
    ...box,
    x: box.x * imageWidth,
    y: box.y * imageHeight,
    width: box.width * imageWidth,
    height: box.height * imageHeight
  };
}

export function normalizedBoxesToPixels(
  boxes,
  imageWidth,
  imageHeight
) {
  if (!Array.isArray(boxes)) {
    throw new TypeError("Boxes must be an array.");
  }

  return boxes.map((box) =>
    normalizedToPixels(box, imageWidth, imageHeight)
  );
}

export function scaleBox(box, fromWidth, fromHeight, toWidth, toHeight) {
  return {
    ...box,
    x: box.x * (toWidth / fromWidth),
    y: box.y * (toHeight / fromHeight),
    width: box.width * (toWidth / fromWidth),
    height: box.height * (toHeight / fromHeight)
  };
}

export function scaleBoxes(
  boxes,
  fromWidth,
  fromHeight,
  toWidth,
  toHeight
) {
  return boxes.map((box) =>
    scaleBox(
      box,
      fromWidth,
      fromHeight,
      toWidth,
      toHeight
    )
  );
}
