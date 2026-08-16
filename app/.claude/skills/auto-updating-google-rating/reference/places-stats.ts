/**
 * Server-only helper that fetches a Google Places listing's rating and review
 * count, cached for 7 days via Next.js ISR. Returns `null` if the key is
 * missing or the API call fails — the caller decides what to show in that case
 * (fall back to existing static copy, or hide the badge). It NEVER invents a
 * number, so the live site can never display a fabricated review count.
 *
 * Requires GOOGLE_PLACES_API_KEY set as a server-only env var on the host.
 * NEVER prefix it with NEXT_PUBLIC_ — the key must not ship to the browser.
 *
 * The 7-day cache (`revalidate: 604800`) is deliberate: Google bills per
 * Place Details call and rate-limits, and a review count does not move fast.
 * Do not drop this to a live per-request fetch.
 *
 * This is the proven runtime helper. Copy it verbatim; only the Place ID you
 * pass in and the presentation around it are site-specific.
 */

export type PlaceStats = { rating: number; count: number };

export async function getPlaceStats(placeId: string): Promise<PlaceStats | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !placeId) return null;
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "rating,userRatingCount",
        },
        next: { revalidate: 604800 }, // 7 days
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.rating !== "number" || typeof data.userRatingCount !== "number") {
      return null;
    }
    return { rating: data.rating, count: data.userRatingCount };
  } catch {
    return null;
  }
}

/**
 * Format a review count for display. Defaults to the locale's grouping
 * (e.g. "1,827"). For large, round-ish counts a softened "1,800+" reads well —
 * uncomment the rounding below if you prefer that. For small counts (e.g. 23)
 * show the exact number; a trailing "+" looks odd on small numbers.
 */
export function formatReviewCount(n: number): string {
  // const rounded = n >= 100 ? Math.floor(n / 100) * 100 : n;
  // return `${rounded.toLocaleString()}+`;
  return n.toLocaleString();
}

/**
 * OPTIONAL extension — recent review cards.
 *
 * Google Places returns at most 5 reviews, in a pricier Place Details SKU, and
 * Google's terms require visible attribution ("from Google") and forbid storing
 * the text long-term. Only enable this if the operator asked for review cards;
 * the rating + count badge above is the default and is enough for most sites.
 *
 * export type PlaceReview = {
 *   author: string;
 *   rating: number;
 *   text: string;
 *   relativeTime: string;
 *   profilePhoto?: string;
 * };
 *
 * export async function getPlaceReviews(placeId: string): Promise<PlaceReview[]> {
 *   const key = process.env.GOOGLE_PLACES_API_KEY;
 *   if (!key || !placeId) return [];
 *   try {
 *     const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
 *       headers: {
 *         "X-Goog-Api-Key": key,
 *         "X-Goog-FieldMask": "reviews",
 *       },
 *       next: { revalidate: 604800 },
 *     });
 *     if (!res.ok) return [];
 *     const data = await res.json();
 *     return (data.reviews ?? []).map((r: any) => ({
 *       author: r.authorAttribution?.displayName ?? "Google reviewer",
 *       rating: typeof r.rating === "number" ? r.rating : 0,
 *       text: r.text?.text ?? r.originalText?.text ?? "",
 *       relativeTime: r.relativePublishTimeDescription ?? "",
 *       profilePhoto: r.authorAttribution?.photoUri,
 *     }));
 *   } catch {
 *     return [];
 *   }
 * }
 */
