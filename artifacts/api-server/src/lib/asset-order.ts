/**
 * Which end of the asset library a list request wants first.
 *
 * `GET /assets` has always ordered by `createdAt` ASCENDING, and the Asset
 * Library's paging is built on that, so it stays the default. But the `@`
 * mention picker needs the opposite: someone who just uploaded and approved an
 * asset expects to find it, and "oldest first" put a brand-new row ~1,300
 * places down a list the picker only ever read the first 50 of. That is the
 * mechanism behind "the new approved assets do not show up in the @ dropdown"
 * (Jeffrey, 14–20 Aug 2026).
 *
 * So this is additive and opt-in: only `?order=recent` changes anything, and
 * every existing caller keeps the order it was written against.
 */
export type AssetListOrder = "oldest" | "recent";

export function resolveAssetListOrder(raw: unknown): AssetListOrder {
  return raw === "recent" ? "recent" : "oldest";
}
