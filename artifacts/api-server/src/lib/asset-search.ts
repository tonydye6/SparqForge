/**
 * How a typed phrase is matched against an asset's name and description.
 *
 * The old rule was ONE contiguous `ILIKE '%<the whole string>%'`, which is
 * wrong for this library because the library does not agree with itself about
 * separators: it holds `Partner Logo Bengals` and `Logo Wordmark Black 01`
 * next to `crownu_char_female_blue_tennis_default`. So typing "Crown U logo"
 * could never find `crownu_3d_logo` — not because the asset was missing, but
 * because the space, the underscore and the intervening "3d" all had to line up
 * exactly. Jeffrey hit this on the `@` picker; the Asset Library's own search
 * box had the same defect.
 *
 * The rule now: split what was typed into words, and require EVERY word to
 * appear somewhere in the asset's text, with separators removed from both
 * sides. Order does not matter, punctuation does not matter, and each extra
 * word narrows rather than broadens.
 *
 *   "logo"          → every asset with "logo" anywhere
 *   "Crown U logo"  → crown AND u AND logo → finds `crownu_3d_logo`
 *   "crownu"        → finds `Crown U Logo`, because the haystack is compacted too
 *
 * `mentions.tsx` mirrors these two functions on the client, where it narrows an
 * in-flight page against the live keystrokes. The two MUST agree: a client that
 * matched more loosely would offer rows the server would not, and one that
 * matched more strictly would hide rows the server found. Both are covered by
 * the same table of cases in their respective tests.
 */

/** Beyond this, extra words are noise and each one costs a scan. */
export const MAX_SEARCH_TOKENS = 8;

/** Lowercase and strip everything that is not a letter or digit. */
export function compactText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * The words in a typed phrase, lowercased and stripped of punctuation.
 *
 * Every token is alphanumeric by construction, which is also why the SQL below
 * can interpolate one into a `LIKE` pattern without escaping `%` or `_`.
 */
export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TOKENS);
}
