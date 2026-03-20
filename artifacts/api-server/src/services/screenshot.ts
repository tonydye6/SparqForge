import * as fs from "fs";
import * as path from "path";
import * as net from "net";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads", "generated");

const BLOCKED_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
];

export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new Error("This URL target is not allowed");
  }

  if (net.isIP(hostname)) {
    const parts = hostname.split(".").map(Number);
    if (parts[0] === 10) throw new Error("Private IP addresses are not allowed");
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) throw new Error("Private IP addresses are not allowed");
    if (parts[0] === 192 && parts[1] === 168) throw new Error("Private IP addresses are not allowed");
    if (parts[0] === 169 && parts[1] === 254) throw new Error("Link-local addresses are not allowed");
  }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export interface ScreenshotResult {
  filename: string;
  filepath: string;
  url: string;
  viewport: string;
}

export async function captureScreenshots(
  targetUrl: string,
  campaignId: string,
): Promise<ScreenshotResult[]> {
  const apiKey = process.env.SparqForge_ScreenshotOne_API_Key;
  if (!apiKey) {
    throw new Error("ScreenshotOne API key not configured (SparqForge_ScreenshotOne_API_Key)");
  }

  ensureDir(UPLOADS_DIR);

  const viewports = [
    { width: 1440, height: 900, label: "desktop" },
    { width: 375, height: 812, label: "mobile" },
  ];

  const results: ScreenshotResult[] = [];

  for (const vp of viewports) {
    const params = new URLSearchParams({
      access_key: apiKey,
      url: targetUrl,
      full_page: "true",
      viewport_width: String(vp.width),
      viewport_height: String(vp.height),
      format: "png",
      block_ads: "true",
      block_cookie_banners: "true",
      block_trackers: "true",
      delay: "3",
      timeout: "30",
    });

    const screenshotUrl = `https://api.screenshotone.com/take?${params.toString()}`;

    const response = await fetch(screenshotUrl);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`ScreenshotOne API error for ${vp.label} viewport: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const timestamp = Date.now();
    const filename = `ref-${campaignId}-${vp.label}-${timestamp}.png`;
    const filepath = path.join(UPLOADS_DIR, filename);

    fs.writeFileSync(filepath, buffer);

    results.push({
      filename,
      filepath,
      url: `/api/files/generated/${filename}`,
      viewport: vp.label,
    });
  }

  return results;
}

export async function captureFromUpload(
  fileBuffer: Buffer,
  campaignId: string,
  originalName: string,
): Promise<ScreenshotResult> {
  ensureDir(UPLOADS_DIR);

  const ext = path.extname(originalName) || ".png";
  const timestamp = Date.now();
  const filename = `ref-${campaignId}-upload-${timestamp}${ext}`;
  const filepath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(filepath, fileBuffer);

  return {
    filename,
    filepath,
    url: `/api/files/generated/${filename}`,
    viewport: "upload",
  };
}
