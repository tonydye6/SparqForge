/**
 * The `@` mention picker, against the two defects Jeffrey reported in August.
 *
 * 1. **The index was the oldest 50 rows, not the library.** The picker asked
 *    `/api/assets?brandId=…&type=visual` with no `limit` and no `search`, so it
 *    got the route's default page — 50 rows ordered by `createdAt` ASCENDING —
 *    and then filtered those 50 in memory. Crown U has ~1,300 visual assets, so
 *    a NEWLY added one is the newest of 1,300 and could never be in the page,
 *    whatever the user typed. Approving it changed nothing because nothing in
 *    this path ever looked at `status`. These tests pin the search to the
 *    SERVER, so the whole library is searched.
 *
 * 2. **The dropdown was clipped and could not scroll.** It rendered in normal
 *    flow inside StudioV2's `min-h-0 flex-1 overflow-y-auto` pane with
 *    `overflow-hidden`, no height bound and no internal scrolling, always
 *    opening downward — so rows below the pane's edge were unreachable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import {
  MentionPickerList,
  assetSearchUrl,
  placePicker,
  useMentions,
  MENTION_FETCH_LIMIT,
  MENTION_MIN_QUERY_CHARS,
  PICKER_MAX_HEIGHT,
  matchesQuery,
  searchTokens,
  compactText,
  type AssetOption,
} from "./mentions";

/**
 * A library shaped like Crown U's: far more rows than one page, with the asset
 * the user actually wants created LAST, so it sorts newest.
 */
const LIBRARY: AssetOption[] = [
  ...Array.from({ length: 1200 }, (_, i) => ({
    id: `old-${i}`,
    name: `crownu_stock_${i}`,
    assetClass: "style_reference",
    compositingOnly: false,
    description: `stock plate ${i}`,
    thumbnailUrl: null,
    fileUrl: `https://cdn.test/old-${i}.png`,
    generationAllowed: true,
    approvedForCompositing: false,
  })),
  {
    id: "spaced-logo",
    name: "Partner Logo Bengals",
    assetClass: null,
    compositingOnly: false,
    description: null,
    thumbnailUrl: null,
    fileUrl: "https://cdn.test/spaced-logo.png",
    generationAllowed: true,
    approvedForCompositing: false,
  },
  {
    id: "snake-logo",
    name: "crownu_3d_logo",
    assetClass: null,
    compositingOnly: false,
    description: null,
    thumbnailUrl: null,
    fileUrl: "https://cdn.test/snake-logo.png",
    generationAllowed: true,
    approvedForCompositing: false,
  },
  {
    id: "crownu-3d-logo",
    name: "CrownU 3D Logo",
    assetClass: null,
    compositingOnly: false,
    description: "the dimensional crest",
    thumbnailUrl: null,
    fileUrl: "https://cdn.test/crownu-3d-logo.png",
    generationAllowed: true,
    approvedForCompositing: false,
  },
];

/** Stands in for `GET /api/assets`, including its paging and ordering. */
function serveAssets(url: string) {
  const parsed = new URL(url, "https://app.test");
  const search = parsed.searchParams.get("search");
  const limit = Number(parsed.searchParams.get("limit") ?? 50);
  const order = parsed.searchParams.get("order");

  // The route orders by createdAt; "recent" is newest-first. LIBRARY is in
  // creation order, so newest-first is the reverse.
  const ordered = order === "recent" ? [...LIBRARY].reverse() : LIBRARY;
  // Mirrors the route: every typed word must appear in the compacted text.
  const tokens = search ? searchTokens(search) : [];
  const matched = tokens.length
    ? ordered.filter((a) => {
        const hay = compactText(`${a.name} ${a.description ?? ""}`);
        return tokens.every((t) => hay.includes(t));
      })
    : ordered;

  return {
    ok: true,
    json: async () => ({ data: matched.slice(0, limit), total: matched.length, limit, offset: 0 }),
  } as unknown as Response;
}

/** Minimal composer: one textarea wired to the hook, like every real caller. */
function Harness({ brandId = "crown-u" }: { brandId?: string | null }) {
  const [line, setLine] = useState("");
  const m = useMentions(brandId);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <div className="relative">
      <textarea
        ref={ref}
        aria-label="brief"
        value={line}
        onChange={(e) => {
          setLine(e.target.value);
          m.onLineChange(e.target.value, e.target.selectionStart);
        }}
      />
      <MentionPickerList
        m={m}
        pickerId="test-picker"
        onChoose={(a) => {
          const next = m.choose(a, line, line.length);
          if (next) setLine(next.line);
        }}
      />
    </div>
  );
}

/** Type `text` into the textarea with the caret at the end, as a user would. */
function type(text: string) {
  const ta = screen.getByLabelText("brief") as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: text, selectionStart: text.length } });
}

describe("assetSearchUrl", () => {
  it("asks the server to do the searching, not the client", () => {
    const url = assetSearchUrl("crown-u", "crownu 3d");
    const q = new URL(url, "https://app.test").searchParams;
    expect(q.get("search")).toBe("crownu 3d");
    expect(q.get("brandId")).toBe("crown-u");
    expect(q.get("type")).toBe("visual");
  });

  it("asks for the NEWEST rows, so a just-added asset is on the first page", () => {
    const q = new URL(assetSearchUrl("crown-u", ""), "https://app.test").searchParams;
    expect(q.get("order")).toBe("recent");
    expect(Number(q.get("limit"))).toBe(MENTION_FETCH_LIMIT);
    // An empty query must not become `search=`, which would match nothing.
    expect(q.has("search")).toBe(false);
  });
});

describe("placePicker", () => {
  const anchor = { top: 200, bottom: 240, left: 32, width: 480 };

  it("opens below the composer and is never taller than its own cap", () => {
    const p = placePicker(anchor, 1000);
    expect(p.placement).toBe("below");
    expect(p.top).toBeGreaterThanOrEqual(anchor.bottom);
    expect(p.maxHeight).toBeLessThanOrEqual(PICKER_MAX_HEIGHT);
    expect(p.maxHeight).toBeGreaterThan(0);
  });

  it("never runs off the bottom of the viewport", () => {
    // The composer sits low: only ~60px of room underneath.
    const low = { top: 660, bottom: 700, left: 32, width: 480 };
    const p = placePicker(low, 760);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(760);
  });

  it("flips above the composer when there is no room below it", () => {
    const low = { top: 660, bottom: 700, left: 32, width: 480 };
    const p = placePicker(low, 760);
    expect(p.placement).toBe("above");
    expect(p.top).toBeLessThan(low.top);
    expect(p.maxHeight).toBeGreaterThan(0);
  });

  it("stays on screen even when the composer fills the viewport", () => {
    const p = placePicker({ top: 0, bottom: 900, left: 0, width: 300 }, 900);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(900);
  });
});

describe("the mention picker", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(serveAssets(url))));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers a newly added asset that is nowhere near the oldest 50 rows", async () => {
    render(<Harness />);
    type("@CrownU 3D");

    // The whole point: this asset is #1201 by creation order. A client-side
    // filter over the first page could never surface it.
    expect(await screen.findByText("CrownU 3D Logo")).toBeInTheDocument();
  });

  it("sends the typed query to the server rather than filtering a stale page", async () => {
    render(<Harness />);
    type("@CrownU 3D");

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls;
      const searched = calls.map((c) => String(c[0])).filter((u) => u.includes("search="));
      expect(searched.length).toBeGreaterThan(0);
      expect(searched.at(-1)).toContain("search=CrownU+3D");
    });
  });

  it("re-queries the server as the query changes, so the index is never stale", async () => {
    render(<Harness />);
    type("@crownu_stock_1199");
    expect(await screen.findByText("crownu_stock_1199")).toBeInTheDocument();

    type("@CrownU 3D");
    expect(await screen.findByText("CrownU 3D Logo")).toBeInTheDocument();
  });

  it("escapes the clipping scroll pane by rendering to the document body", async () => {
    const { container } = render(<Harness />);
    type("@crownu");

    const list = await screen.findByRole("listbox");
    // Rendered outside the composer's subtree, so an ancestor's
    // `overflow-y-auto` cannot cut it off.
    expect(container.contains(list)).toBe(false);
    expect(document.body.contains(list)).toBe(true);
  });

  it("can scroll internally and is height-bounded", async () => {
    render(<Harness />);
    type("@crownu");

    const list = await screen.findByRole("listbox");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).not.toContain("overflow-hidden");
    // A real pixel bound, so the list can never simply run off the screen.
    expect(list.style.maxHeight).toMatch(/^\d+px$/);
    expect(parseInt(list.style.maxHeight, 10)).toBeGreaterThan(0);
    expect(list.style.position).toBe("fixed");
  });

  it("shows more than the eight rows the old cap allowed", async () => {
    render(<Harness />);
    type("@crownu_stock");

    await waitFor(() => {
      expect(screen.getAllByRole("option").length).toBeGreaterThan(8);
    });
  });

  it("does not dump the library when the user has only typed @", async () => {
    render(<Harness />);
    type("@");

    const list = await screen.findByRole("listbox");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(list.textContent).toMatch(/type/i);
    // And it must not have gone to the server for a list nobody asked for.
    const calls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls;
    expect(calls).toHaveLength(0);
  });

  it("stops offering rows once the @ token is emptied again", async () => {
    render(<Harness />);
    type("@crownu_stock_1199");
    expect(await screen.findByText("crownu_stock_1199")).toBeInTheDocument();

    type("@");
    await waitFor(() => {
      expect(screen.queryAllByRole("option")).toHaveLength(0);
    });
  });

  it("never shows a row that contradicts what is currently typed", async () => {
    // The defect this pins: matching moved to the server, so for one debounce
    // window `matches` held the PREVIOUS query's rows — and Enter picks
    // matches[highlight], so a fast typist attached an asset they never named.
    render(<Harness />);
    type("@crownu_stock_1199");
    expect(await screen.findByText("crownu_stock_1199")).toBeInTheDocument();

    // Immediately retype, well inside the debounce: the stale row must be gone
    // on the very next render, not 140ms later.
    type("@CrownU 3D");
    expect(screen.queryByText("crownu_stock_1199")).not.toBeInTheDocument();
  });

  it("keeps a row the server matched on description, not name", async () => {
    render(<Harness />);
    type("@dimensional crest");

    // Narrowing has to use the same predicate the server used, or a
    // description hit is thrown away the moment the user types one more letter.
    expect(await screen.findByText("CrownU 3D Logo")).toBeInTheDocument();
  });

  it("offers an underscored asset when the phrase is typed with spaces", async () => {
    render(<Harness />);
    type("@Crown U logo");

    // Both naming conventions answer the same typed phrase.
    expect(await screen.findByText("crownu_3d_logo")).toBeInTheDocument();
    expect(screen.getByText("CrownU 3D Logo")).toBeInTheDocument();
  });

  it("offers every asset with the typed word anywhere in the name", async () => {
    render(<Harness />);
    type("@logo");

    expect(await screen.findByText("Partner Logo Bengals")).toBeInTheDocument();
    expect(screen.getByText("crownu_3d_logo")).toBeInTheDocument();
    expect(screen.getByText("CrownU 3D Logo")).toBeInTheDocument();
  });

  it("says how many matched when it could only show a page of them", async () => {
    render(<Harness />);
    type("@crownu_stock");

    const note = await screen.findByTestId("mention-truncated");
    // 1200 stock plates match; the page holds 50.
    expect(note.textContent).toContain("1200");
    expect(note.textContent).toMatch(/showing 50/i);
  });

  it("does not claim truncation when everything matching is on screen", async () => {
    render(<Harness />);
    type("@Partner Logo Bengals");

    expect(await screen.findByText("Partner Logo Bengals")).toBeInTheDocument();
    expect(screen.queryByTestId("mention-truncated")).not.toBeInTheDocument();
  });

  it("lazy-loads row thumbnails, which are full-size asset files", async () => {
    render(<Harness />);
    type("@crownu_stock");

    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(8));
    const imgs = screen.getByRole("listbox").querySelectorAll("img");
    expect(imgs.length).toBeGreaterThan(0);
    imgs.forEach((img) => expect(img.getAttribute("loading")).toBe("lazy"));
  });
});

describe("token matching, the way a person actually types", () => {
  const snake = { name: "crownu_3d_logo", description: null };
  const spaced = { name: "Crown U Logo", description: null };
  const partner = { name: "Partner Logo Bengals", description: null };

  it("finds an underscored asset from a phrase typed with spaces", () => {
    // The reported gap: "Crown U logo" could never match `crownu_3d_logo`,
    // because one contiguous ILIKE needed the space, the underscore and the
    // intervening "3d" to line up exactly.
    expect(matchesQuery(snake, "Crown U logo")).toBe(true);
    expect(matchesQuery(snake, "crown u logo")).toBe(true);
    expect(matchesQuery(snake, "Crown_U_Logo")).toBe(true);
  });

  it("finds a spaced asset from a run-together phrase", () => {
    expect(matchesQuery(spaced, "crownu")).toBe(true);
    expect(matchesQuery(spaced, "crownulogo")).toBe(true);
  });

  it("matches one word anywhere in the name", () => {
    expect(matchesQuery(partner, "logo")).toBe(true);
    expect(matchesQuery(snake, "logo")).toBe(true);
    expect(matchesQuery(spaced, "logo")).toBe(true);
  });

  it("does not care what order the words come in", () => {
    expect(matchesQuery(partner, "bengals logo")).toBe(true);
    expect(matchesQuery(partner, "logo bengals")).toBe(true);
  });

  it("narrows with each added word rather than broadening", () => {
    expect(matchesQuery(partner, "logo")).toBe(true);
    expect(matchesQuery(partner, "logo bengals")).toBe(true);
    // "dolphins" is not in this asset, so the phrase no longer matches it.
    expect(matchesQuery(partner, "logo dolphins")).toBe(false);
  });

  it("still requires every word to be present", () => {
    expect(matchesQuery(snake, "crown u logo mascot")).toBe(false);
    expect(matchesQuery(spaced, "rumble logo")).toBe(false);
  });

  it("tolerates a half-typed trailing word", () => {
    expect(matchesQuery(snake, "crown u lo")).toBe(true);
    expect(matchesQuery(partner, "part log beng")).toBe(true);
  });
});

describe("searchTokens / compactText", () => {
  it("splits on anything that is not a letter or digit", () => {
    expect(searchTokens("Crown_U 3D-Logo.png")).toEqual(["crown", "u", "3d", "logo", "png"]);
  });

  it("yields no tokens for punctuation alone, so nothing is searched", () => {
    expect(searchTokens("   ")).toEqual([]);
    expect(searchTokens("__--__")).toEqual([]);
  });

  it("caps the number of words so one paste cannot fan out unbounded scans", () => {
    expect(searchTokens("a b c d e f g h i j k l").length).toBeLessThanOrEqual(8);
  });

  it("compacts both conventions to the same shape", () => {
    expect(compactText("crownu_3d_logo")).toBe("crownu3dlogo");
    expect(compactText("Crown U 3D Logo")).toBe("crownu3dlogo");
  });
});

describe("matchesQuery", () => {
  const asset = {
    id: "a",
    name: "CrownU 3D Logo",
    assetClass: null,
    compositingOnly: false,
    description: "the dimensional crest",
    thumbnailUrl: null,
    fileUrl: "https://cdn.test/a.png",
  };

  it("mirrors the server: name OR description, case-insensitively", () => {
    expect(matchesQuery(asset, "crownu")).toBe(true);
    expect(matchesQuery(asset, "3D LOGO")).toBe(true);
    expect(matchesQuery(asset, "dimensional")).toBe(true);
    expect(matchesQuery(asset, "rumble")).toBe(false);
  });

  it("treats an empty query as matching nothing, since @ alone offers nothing", () => {
    expect(matchesQuery(asset, "")).toBe(false);
    expect(matchesQuery(asset, "   ")).toBe(false);
  });

  it("survives an asset with no description at all", () => {
    expect(matchesQuery({ ...asset, description: null }, "crownu")).toBe(true);
    expect(matchesQuery({ ...asset, description: null }, "crest")).toBe(false);
  });
});

describe("the picker's empty states", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(serveAssets(url))));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires at least one typed character before it searches at all", () => {
    expect(MENTION_MIN_QUERY_CHARS).toBeGreaterThanOrEqual(1);
  });

  it("says it is still loading rather than claiming the library has no match", async () => {
    // A fetch that never settles: the picker must not assert "nothing matches".
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<Harness />);
    type("@crownu");

    const list = await screen.findByRole("listbox");
    expect(list.textContent).toContain("Searching");
    expect(list.textContent).not.toContain("Nothing in this brand's library");
  });

  it("says there is no brand yet, rather than hanging on 'searching'", async () => {
    // With no brand the request is not pending — it is never going to be made.
    // This used to sit on "Loading this brand's assets..." forever.
    render(<Harness brandId={null} />);
    type("@crown");

    const list = await screen.findByRole("listbox");
    expect(list.textContent).toMatch(/pick a brand/i);
    expect(list.textContent).not.toMatch(/searching/i);
    expect(list.textContent).not.toContain("Nothing in this brand's library");
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it("still says plainly when the library genuinely has no match", async () => {
    render(<Harness />);
    type("@nothing_like_this_exists");

    await waitFor(() => {
      expect(screen.getByRole("listbox").textContent).toContain("Nothing in this brand's library");
    });
  });
});
