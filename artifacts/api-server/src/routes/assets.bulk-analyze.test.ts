import type { Request, Response } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Dev-auth bypass so importing the auth middleware never hits a real DB.
process.env.DEV_AUTH_BYPASS = "true";

// --- Table sentinels -------------------------------------------------------
const assetsTable = { __name: "assets", id: "id" };
const creativesTable = { __name: "creatives" };

// --- Configurable per-test DB results --------------------------------------
let selectResult: Array<Record<string, unknown>> = [];

const db = {
  insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
  delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
  update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
  select: () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => Promise.resolve(selectResult),
      limit: () => chain,
      orderBy: () => chain,
      then: (r: (v: unknown) => unknown) => Promise.resolve(selectResult).then(r),
    };
    return chain;
  },
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
};

vi.mock("@workspace/db", () => ({ db, assetsTable, creativesTable }));

const op = () => ({});
vi.mock("drizzle-orm", () => ({
  eq: op, ne: op, and: op, or: op, inArray: op, ilike: op, desc: op,
  arrayContains: op, isNull: op,
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));

vi.mock("../services/storage.js", () => ({
  resolveUrl: vi.fn(),
  readBuffer: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock("../services/backfill-assets.js", () => ({ backfillAssetClassifications: vi.fn() }));
vi.mock("../services/asset-matching.js", () => ({ matchAssetsToBrief: vi.fn() }));
vi.mock("../services/deletion.js", () => ({
  softDeleteBackingObjects: vi.fn(async () => ({ failed: [] })),
  MAX_BULK_DELETE: 50,
}));
vi.mock("../lib/audit.js", () => ({
  recordAudit: vi.fn(async () => undefined),
  actorFromRequest: vi.fn(() => ({ id: "user-42" })),
}));

// Mock the analysis service but keep the REAL isAnalyzableAsset skip logic —
// that is exactly what this test guards. Only the model call is stubbed.
const analyzeAndStoreAsset = vi.fn();
vi.mock("../services/asset-analysis.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/asset-analysis.js")>();
  return {
    ...actual,
    analyzeAndStoreAsset,
    analyzeAssetInBackground: vi.fn(),
    backfillAssetAnalysis: vi.fn(),
  };
});
vi.mock("@workspace/integrations-gemini-ai", () => ({ ai: {} }));
vi.mock("../lib/ai-config.js", () => ({
  AI_MODELS: { GEMINI_FLASH_TEXT: "test-model" },
  estimateGeminiTextCost: vi.fn(() => 0),
}));

const assetsModule = await import("./assets.js");
const assetsRouter = assetsModule.default;
const { MAX_BULK_ANALYZE } = assetsModule;

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
}
function getHandler(
  router: { stack: RouteLayer[] },
  method: string,
  path: string,
): (req: Request, res: Response) => Promise<void> {
  const layer = (router.stack as RouteLayer[]).find(
    (l) => l.route?.path === path && l.route?.methods?.[method] === true,
  );
  if (!layer?.route) throw new Error(`route not found: ${method} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: Request, res: Response) => Promise<void>;
}

const handler = getHandler(assetsRouter as never, "post", "/assets/bulk-analyze");

function mockReq(body: Record<string, unknown>): Request {
  return { body, params: {}, query: {}, user: { id: "user-42", role: "admin" } } as unknown as Request;
}

interface CapturingRes {
  statusCode: number;
  body: Record<string, unknown> | undefined;
  status: (c: number) => CapturingRes;
  json: (b: unknown) => CapturingRes;
}
function mockRes(): CapturingRes {
  const res: CapturingRes = {
    statusCode: 200,
    body: undefined,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json(b: unknown) {
      res.body = b as Record<string, unknown>;
      return res;
    },
  };
  return res;
}

function makeAsset(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `asset-${Math.random().toString(36).slice(2, 8)}`,
    name: "photo.png",
    type: "visual",
    fileUrl: "/api/files/photo.png",
    mimeType: "image/png",
    aiAnalyzedAt: null,
    ...over,
  };
}

beforeEach(() => {
  selectResult = [];
  analyzeAndStoreAsset.mockReset();
  analyzeAndStoreAsset.mockResolvedValue({});
});

describe("POST /assets/bulk-analyze — input validation", () => {
  it("400s when ids is missing", async () => {
    const res = mockRes();
    await handler(mockReq({}), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it("400s when ids is empty", async () => {
    const res = mockRes();
    await handler(mockReq({ ids: [] }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it("400s when unique ids exceed the cap", async () => {
    const ids = Array.from({ length: MAX_BULK_ANALYZE + 1 }, (_, i) => `id-${i}`);
    const res = mockRes();
    await handler(mockReq({ ids }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(String(res.body?.error)).toContain(String(MAX_BULK_ANALYZE));
    expect(analyzeAndStoreAsset).not.toHaveBeenCalled();
  });

  it("accepts duplicate-heavy input whose unique count is within the cap", async () => {
    // 100 raw ids but only 50 unique — must NOT be rejected.
    const unique = Array.from({ length: MAX_BULK_ANALYZE }, (_, i) => `id-${i}`);
    const ids = [...unique, ...unique];
    selectResult = [];
    const res = mockRes();
    await handler(mockReq({ ids }), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body?.skipped).toBe(MAX_BULK_ANALYZE);
  });
});

describe("POST /assets/bulk-analyze — eligibility filtering (real isAnalyzableAsset)", () => {
  it("analyzes only eligible assets; skips already-analyzed, videos, non-visuals, and missing files", async () => {
    const eligible = makeAsset({ id: "a-ok" });
    const alreadyAnalyzed = makeAsset({ id: "a-done", aiAnalyzedAt: new Date() });
    const video = makeAsset({ id: "a-vid", mimeType: "video/mp4" });
    const brief = makeAsset({ id: "a-brief", type: "context" });
    const noFile = makeAsset({ id: "a-nofile", fileUrl: null });
    selectResult = [eligible, alreadyAnalyzed, video, brief, noFile];

    const res = mockRes();
    await handler(
      mockReq({ ids: ["a-ok", "a-done", "a-vid", "a-brief", "a-nofile", "a-missing"] }),
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(200);
    expect(analyzeAndStoreAsset).toHaveBeenCalledTimes(1);
    expect(analyzeAndStoreAsset).toHaveBeenCalledWith("a-ok");
    expect(res.body).toMatchObject({
      queued: 1,
      analyzed: 1,
      failed: 0,
      // 4 ineligible + 1 not found in DB
      skipped: 5,
    });
    expect(res.body?.errors).toEqual([]);
  });

  it("counts everything as skipped when nothing is eligible and makes no analysis calls", async () => {
    selectResult = [makeAsset({ id: "v1", mimeType: "video/quicktime" })];
    const res = mockRes();
    await handler(mockReq({ ids: ["v1", "v1", "gone"] }), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(analyzeAndStoreAsset).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ queued: 0, analyzed: 0, failed: 0, skipped: 2 });
  });
});

describe("POST /assets/bulk-analyze — per-asset failure isolation", () => {
  it("keeps analyzing other assets when one fails and reports the error", async () => {
    const a = makeAsset({ id: "a1", name: "one.png" });
    const b = makeAsset({ id: "a2", name: "two.png" });
    const c = makeAsset({ id: "a3", name: "three.png" });
    selectResult = [a, b, c];
    analyzeAndStoreAsset.mockImplementation(async (id: string) => {
      if (id === "a2") throw new Error("model exploded");
      return {};
    });

    const res = mockRes();
    await handler(mockReq({ ids: ["a1", "a2", "a3"] }), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(analyzeAndStoreAsset).toHaveBeenCalledTimes(3);
    expect(res.body).toMatchObject({ queued: 3, analyzed: 2, failed: 1, skipped: 0 });
    expect(res.body?.errors).toEqual([
      { assetId: "a2", name: "two.png", error: "model exploded" },
    ]);
  });

  it("stringifies non-Error throws", async () => {
    selectResult = [makeAsset({ id: "a1", name: "one.png" })];
    analyzeAndStoreAsset.mockRejectedValue("plain string failure");
    const res = mockRes();
    await handler(mockReq({ ids: ["a1"] }), res as unknown as Response);
    expect(res.body?.failed).toBe(1);
    expect((res.body?.errors as Array<{ error: string }>)[0].error).toBe("plain string failure");
  });
});

describe("POST /assets/bulk-analyze — concurrency batching", () => {
  it("never runs more than 3 analyses at once and still processes all assets", async () => {
    const assets = Array.from({ length: 8 }, (_, i) => makeAsset({ id: `c-${i}` }));
    selectResult = assets;

    let inFlight = 0;
    let maxInFlight = 0;
    analyzeAndStoreAsset.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return {};
    });

    const res = mockRes();
    await handler(mockReq({ ids: assets.map((a) => a.id as string) }), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(analyzeAndStoreAsset).toHaveBeenCalledTimes(8);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(res.body).toMatchObject({ queued: 8, analyzed: 8, failed: 0, skipped: 0 });
  });

  it("a failure in one batch does not stop later batches", async () => {
    const assets = Array.from({ length: 5 }, (_, i) => makeAsset({ id: `b-${i}` }));
    selectResult = assets;
    analyzeAndStoreAsset.mockImplementation(async (id: string) => {
      if (id === "b-0") throw new Error("first batch failure");
      return {};
    });

    const res = mockRes();
    await handler(mockReq({ ids: assets.map((a) => a.id as string) }), res as unknown as Response);

    expect(analyzeAndStoreAsset).toHaveBeenCalledTimes(5);
    expect(res.body).toMatchObject({ queued: 5, analyzed: 4, failed: 1 });
  });
});
