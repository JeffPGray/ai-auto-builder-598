/**
 * Presentational starting point for the live Google rating badge.
 *
 * This is a TEMPLATE, not verbatim plumbing: restyle it to match the site's
 * own design system (its fonts, colours, spacing, the look of its existing
 * social-proof line). The job of the skill is to render the LIVE numbers from
 * `getPlaceStats` wherever this site already shows social proof — not to bolt a
 * generic badge onto a bespoke design. Keep the data shape, change the styling.
 *
 * Server component, no client JS. Render it only when `getPlaceStats` returned
 * a non-null value; pass the existing static copy as a fallback (or omit the
 * badge) otherwise, so a missing key or an API hiccup never shows a broken or
 * zero count.
 */
import { formatReviewCount, type PlaceStats } from "@/lib/places-stats";

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="inline-flex" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          viewBox="0 0 20 20"
          className={`h-4 w-4 ${i < full ? "fill-amber-400" : "fill-gray-300"}`}
        >
          <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 15l-5.2 2.6 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
        </svg>
      ))}
    </span>
  );
}

export default function GoogleRating({ stats }: { stats: PlaceStats }) {
  return (
    <div className="inline-flex items-center gap-2 text-sm">
      <Stars rating={stats.rating} />
      <span className="font-semibold">{stats.rating.toFixed(1)}</span>
      <span className="text-gray-600">
        from {formatReviewCount(stats.count)} Google reviews
      </span>
    </div>
  );
}
