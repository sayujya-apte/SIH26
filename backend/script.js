import express from "express";
import cors from "cors";
import { addon as ov } from "openvino-node";
import { PNG } from "pngjs";
import sharp from "sharp";
import { redactScreenshot } from "./redac_eng/redaction-engine.js";
import fs from "fs/promises";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

function calculateIoU(box1, box2) {
  const x1 = Math.max(box1.x1, box2.x1);
  const y1 = Math.max(box1.y1, box2.y1);
  const x2 = Math.min(box1.x2, box2.x2);
  const y2 = Math.min(box1.y2, box2.y2);

  const intersectionArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const box1Area = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
  const box2Area = (box2.x2 - box2.x1) * (box2.y2 - box2.y1);

  return intersectionArea / (box1Area + box2Area - intersectionArea);
}

function processYOLOv8Output(results, confThreshold = 0.25, iouThreshold = 0.45) {
  const numClasses = 80; // Assuming standard COCO dataset
  const numAnchors = 8400; // 640x640 grid cells
  let boxes = [];

  // 1. Parse and Filter by Confidence
  for (let col = 0; col < numAnchors; col++) {
    let maxConf = 0;
    let classId = -1;

    // The first 4 rows are cx, cy, w, h. Rows 4-83 are class confidences.
    for (let c = 0; c < numClasses; c++) {
      const conf = results[(4 + c) * numAnchors + col];
      if (conf > maxConf) {
        maxConf = conf;
        classId = c;
      }
    }

    // Convert center x/y and width/height to top-left and bottom-right coords
    if (maxConf >= confThreshold) {
      const cx = results[0 * numAnchors + col];
      const cy = results[1 * numAnchors + col];
      const w = results[2 * numAnchors + col];
      const h = results[3 * numAnchors + col];

      boxes.push({
        id: classId,
        x: cx - w / 2,
        y: cy - h / 2,
        width: w,
        height: h,
      });
    }
  }

  // 2. Non-Maximum Suppression (NMS)
  boxes.sort((a, b) => b.confidence - a.confidence);
  const finalDetections = [];

  while (boxes.length > 0) {
    const bestBox = boxes.shift();
    finalDetections.push(bestBox);
    // Remove remaining boxes that heavily overlap with the bestBox
    boxes = boxes.filter(box => calculateIoU(bestBox, box) < iouThreshold);
  }

  return finalDetections;
}

async function startServer() {
  try {
    // 1. Initialize OpenVINO inside the async scope
    const core = new ov.Core();
    console.log("Loading nano640.xml...");
    const model = await core.readModel("./nano640.xml");
    const compiledModel = await core.compileModel(model, "CPU");
    const inferRequest = compiledModel.createInferRequest();
    console.log("Model loaded successfully!");

    // 2. Define the route using the loaded inferRequest
    app.post("/api/data", async (req, res) => {
      try {
        const { image } = req.body;
        const cleanBase64 = image.replace(/^data:image\/png;base64,/, "");
        const imageBuffer = Buffer.from(cleanBase64, "base64");

        // 1. Resize the image without cropping using 'sharp'
        const resizedBuffer = await sharp(imageBuffer)
          .resize({
            width: 640,
            height: 640,
            fit: 'contain', // Fits the image inside 640x640, padding the rest
            background: { r: 0, g: 0, b: 0, alpha: 1 } // Black padding
          })
          .png()
          .toBuffer();

        // 2. Decode the newly resized 640x640 buffer
        const decodedImg = PNG.sync.read(resizedBuffer);
        const { width, height, data } = decodedImg;

        // (Optional) Sanity check, though sharp guarantees 640x640 here
        if (width !== 640 || height !== 640) {
          throw new Error(`Model expects 640x640, but got ${width}x${height}`); //[cite: 1]
        }

        const floatData = new Float32Array(3 * 640 * 640);
        const channelSize = 640 * 640;

        for (let h = 0; h < 640; h++) {
          for (let w = 0; w < 640; w++) {
            const pixelIndex = (h * 640 + w) * 4;
            const spatialIndex = h * 640 + w;

            floatData[spatialIndex] = data[pixelIndex] / 255.0;
            floatData[channelSize + spatialIndex] = data[pixelIndex + 1] / 255.0;
            floatData[2 * channelSize + spatialIndex] = data[pixelIndex + 2] / 255.0;
          }
        }

        const imageTensor = new ov.Tensor(ov.element.f32, [1, 3, 640, 640], floatData);
        inferRequest.setInputTensor(imageTensor);
        inferRequest.infer();

        // ... [previous inference code] ...
        const outputTensor = inferRequest.getOutputTensor();
        const results = outputTensor.data;

        // Process the raw output
        const cleanDetections = processYOLOv8Output(results);
        const result = redactScreenshot(resizedBuffer, cleanDetections);
        const blob = ((await (result)).blob);
        await fs.writeFile("output.png", blob);

        console.log("Image successfully saved as output.png");
        res.json({ success: true, detections: cleanDetections });

      } catch (error) {
        console.error("Inference Error:", error);
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
      }
    });

    // 3. Start the server only after everything is ready
    app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));

  } catch (error) {
    console.error("Failed to initialize the server:", error);
    process.exit(1);
  }
}

startServer();