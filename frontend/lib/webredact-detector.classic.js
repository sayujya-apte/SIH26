/**
 * webredact-detector.classic.js
 *
 * Classic-script version of the PII detector, for use with importScripts()
 * in a standard (non-ES-module) Manifest V3 background service worker —
 * matches the style already used in background.js.
 *
 * Load order in background.js:
 *   importScripts("lib/ort/ort.min.js");
 *   importScripts("lib/webredact-detector.classic.js");
 *   // detectPII(...) is now available as a global function
 *
 * Wrapped in an IIFE so only `detectPII` is exposed globally — avoids
 * clashing with background.js's own dataUrlToBlob/arrayBufferToBase64 etc.
 */

(function(global) {
    const DEFAULTS = {
        modelPath: null, // resolved to chrome.runtime.getURL("models/nano640_patched.onnx") below
        wasmPaths: null, // resolved to chrome.runtime.getURL("lib/ort/") below
        imgSize: 640,
        confidenceThreshold: 0.50,
        iouThreshold: 0.45,
        classNames: { 0: "class_0", 1: "class_1" }, // rename to actual PII classes if known
    };

    function resolveExtensionUrl(relativePath) {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
            return chrome.runtime.getURL(relativePath);
        }
        return relativePath;
    }

    let cachedSession = null;
    let cachedModelPath = null;

    async function detectPII(base64Image, options = {}) {
        const opts = { ...DEFAULTS, ...options };
        const modelPath = opts.modelPath ?? resolveExtensionUrl("models/nano640_patched.onnx");
        const wasmPaths = opts.wasmPaths ?? resolveExtensionUrl("lib/ort/");

        if (typeof ort === "undefined") {
            throw new Error(
                "onnxruntime-web (global `ort`) not found. Make sure importScripts('lib/ort/ort.min.js') " +
                "runs before importScripts('lib/webredact-detector.classic.js') in background.js."
            );
        }

        ort.env.wasm.wasmPaths = wasmPaths;

        const session = await getSession(modelPath);
        const bitmap = await base64ToImageBitmap(base64Image);

        const { canvas: lbCanvas, scale, padX, padY } = letterbox(bitmap, opts.imgSize);
        bitmap.close?.();
        const inputTensor = imageDataToTensor(lbCanvas, opts.imgSize);

        const inputName = session.inputNames[0];
        const outputMap = await session.run({ [inputName]: inputTensor });
        const outputName = session.outputNames[0];
        const output = outputMap[outputName]; // shape [1, C, N] e.g. [1, 6, 8400]

        return decodeDetections(output, {
            scale,
            padX,
            padY,
            confidenceThreshold: opts.confidenceThreshold,
            iouThreshold: opts.iouThreshold,
            classNames: opts.classNames,
        });
    }

    async function getSession(modelPath) {
        if (cachedSession && cachedModelPath === modelPath) return cachedSession;
        cachedSession = await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] });
        cachedModelPath = modelPath;
        return cachedSession;
    }

    async function base64ToImageBitmap(base64Image) {
        const dataUrl = base64Image.startsWith("data:")
            ? base64Image
            : `data:image/jpeg;base64,${base64Image}`;

        const commaIdx = dataUrl.indexOf(",");
        const meta = dataUrl.slice(0, commaIdx);
        const b64 = dataUrl.slice(commaIdx + 1);
        const mimeMatch = meta.match(/data:([^;]+);base64/);
        const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";

        const byteChars = atob(b64);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
            byteArray[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: mime });
        return createImageBitmap(blob);
    }

    function letterbox(bitmap, size) {
        const scale = Math.min(size / bitmap.width, size / bitmap.height);
        const nw = Math.round(bitmap.width * scale);
        const nh = Math.round(bitmap.height * scale);
        const padX = Math.floor((size - nw) / 2);
        const padY = Math.floor((size - nh) / 2);

        const canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "rgb(114,114,114)";
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, padX, padY, nw, nh);

        return { canvas, scale, padX, padY };
    }

    function imageDataToTensor(offscreenCanvas, size) {
        const ctx = offscreenCanvas.getContext("2d");
        const imageData = ctx.getImageData(0, 0, size, size).data;
        const floatData = new Float32Array(3 * size * size);
        const chSize = size * size;
        for (let i = 0; i < size * size; i++) {
            floatData[i] = imageData[i * 4] / 255.0;
            floatData[chSize + i] = imageData[i * 4 + 1] / 255.0;
            floatData[2 * chSize + i] = imageData[i * 4 + 2] / 255.0;
        }
        return new ort.Tensor("float32", floatData, [1, 3, size, size]);
    }

    function sigmoid(x) {
        return 1 / (1 + Math.exp(-x));
    }

    function nms(boxes, scores, iouThreshold) {
        const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
        const keep = [];
        const suppressed = new Set();

        for (const i of order) {
            if (suppressed.has(i)) continue;
            keep.push(i);
            const [x1i, y1i, x2i, y2i] = boxes[i];
            const areaI = Math.max(0, x2i - x1i) * Math.max(0, y2i - y1i);
            for (const j of order) {
                if (j === i || suppressed.has(j)) continue;
                const [x1j, y1j, x2j, y2j] = boxes[j];
                const xx1 = Math.max(x1i, x1j), yy1 = Math.max(y1i, y1j);
                const xx2 = Math.min(x2i, x2j), yy2 = Math.min(y2i, y2j);
                const w = Math.max(0, xx2 - xx1), h = Math.max(0, yy2 - yy1);
                const inter = w * h;
                const areaJ = Math.max(0, x2j - x1j) * Math.max(0, y2j - y1j);
                const iou = inter / (areaI + areaJ - inter + 1e-9);
                if (iou > iouThreshold) suppressed.add(j);
            }
        }
        return keep;
    }

    function decodeDetections(output, { scale, padX, padY, confidenceThreshold, iouThreshold, classNames }) {
        const data = output.data;
        const numChannels = output.dims[1];
        const numAnchors = output.dims[2];

        let scoreMin = Infinity, scoreMax = -Infinity;
        for (let c = 4; c < numChannels; c++) {
            for (let a = 0; a < numAnchors; a++) {
                const v = data[c * numAnchors + a];
                if (v < scoreMin) scoreMin = v;
                if (v > scoreMax) scoreMax = v;
            }
        }
        const needsSigmoid = scoreMin < -0.01 || scoreMax > 1.01;

        const candidateBoxes = [];
        const candidateScores = [];
        const candidateClasses = [];

        for (let a = 0; a < numAnchors; a++) {
            let bestScore = -Infinity, bestClass = -1;
            for (let c = 4; c < numChannels; c++) {
                let s = data[c * numAnchors + a];
                if (needsSigmoid) s = sigmoid(s);
                if (s > bestScore) { bestScore = s; bestClass = c - 4; }
            }
            if (bestScore >= confidenceThreshold) {
                const cx = data[0 * numAnchors + a];
                const cy = data[1 * numAnchors + a];
                const w = data[2 * numAnchors + a];
                const h = data[3 * numAnchors + a];

                let x1 = cx - w / 2, y1 = cy - h / 2, x2 = cx + w / 2, y2 = cy + h / 2;
                x1 = (x1 - padX) / scale;
                y1 = (y1 - padY) / scale;
                x2 = (x2 - padX) / scale;
                y2 = (y2 - padY) / scale;

                candidateBoxes.push([x1, y1, x2, y2]);
                candidateScores.push(bestScore);
                candidateClasses.push(bestClass);
            }
        }

        const classes = [...new Set(candidateClasses)];
        const finalIndices = [];
        for (const cls of classes) {
            const idxs = candidateClasses.map((c, i) => (c === cls ? i : -1)).filter((i) => i !== -1);
            const clsBoxes = idxs.map((i) => candidateBoxes[i]);
            const clsScores = idxs.map((i) => candidateScores[i]);
            const kept = nms(clsBoxes, clsScores, iouThreshold);
            finalIndices.push(...kept.map((k) => idxs[k]));
        }

        return finalIndices.map((idx) => {
            const [x1, y1, x2, y2] = candidateBoxes[idx];
            const cls = candidateClasses[idx];
            return {
                class: cls,
                className: classNames[cls] ?? `class_${cls}`,
                confidence: candidateScores[idx],
                box: { x1, y1, x2, y2 },
            };
        });
    }

    global.detectPII = detectPII;
})(self);
