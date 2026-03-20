import { Router, type IRouter } from "express";
import { UploadFileResponse } from "@workspace/api-zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const router: IRouter = Router();

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const ALLOWED_FONT_TYPES = ["font/woff2", "font/ttf", "application/x-font-woff2", "application/x-font-ttf", "application/octet-stream"];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav"];
const MAX_FILE_SIZE = 50 * 1024 * 1024;

router.post("/upload", async (req, res): Promise<void> => {
  const contentType = req.headers["content-type"] || "";

  if (!contentType.includes("multipart/form-data") && !contentType.includes("application/octet-stream")) {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const fileId = crypto.randomUUID();
      const ext = ".bin";
      const fileName = `${fileId}${ext}`;
      const filePath = path.join(UPLOAD_DIR, fileName);
      fs.writeFileSync(filePath, buffer);
      const url = `/api/files/${fileName}`;
      res.json(UploadFileResponse.parse({ url }));
    });
    return;
  }

  const chunks: Buffer[] = [];
  let totalSize = 0;

  req.on("data", (chunk) => {
    totalSize += chunk.length;
    if (totalSize > MAX_FILE_SIZE) {
      res.status(413).json({ error: "File too large (max 50MB)" });
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    try {
      const buffer = Buffer.concat(chunks);
      const boundary = contentType.split("boundary=")[1];

      if (!boundary) {
        const fileId = crypto.randomUUID();
        const fileName = `${fileId}.bin`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        fs.writeFileSync(filePath, buffer);
        const url = `/api/files/${fileName}`;
        res.json(UploadFileResponse.parse({ url }));
        return;
      }

      const parts = buffer.toString("binary").split(`--${boundary}`);
      let fileBuffer: Buffer | null = null;
      let originalName = "upload";
      let fileMimeType = "application/octet-stream";

      for (const part of parts) {
        if (part.includes("filename=")) {
          const nameMatch = part.match(/filename="([^"]+)"/);
          if (nameMatch) originalName = nameMatch[1];

          const typeMatch = part.match(/Content-Type:\s*(.+)/i);
          if (typeMatch) fileMimeType = typeMatch[1].trim();

          const headerEnd = part.indexOf("\r\n\r\n");
          if (headerEnd !== -1) {
            const bodyStr = part.substring(headerEnd + 4);
            const cleanBody = bodyStr.replace(/\r\n$/, "");
            fileBuffer = Buffer.from(cleanBody, "binary");
          }
        }
      }

      if (!fileBuffer) {
        res.status(400).json({ error: "No file found in request" });
        return;
      }

      const ext = path.extname(originalName) || ".bin";
      const fileId = crypto.randomUUID();
      const fileName = `${fileId}${ext}`;
      const filePath = path.join(UPLOAD_DIR, fileName);
      fs.writeFileSync(filePath, fileBuffer);

      const url = `/api/files/${fileName}`;
      res.json(UploadFileResponse.parse({ url }));
    } catch {
      res.status(500).json({ error: "Upload processing failed" });
    }
  });
});

router.get("/files/:filename", (req, res): void => {
  const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  };

  res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
  res.sendFile(filePath);
});

export default router;
