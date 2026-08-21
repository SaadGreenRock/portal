/**
 * Shown while a funding screen is fetching.
 *
 * Same arrangement as the food section: the title, the tabs and the way out are
 * in the layout, so this stands in for the page and the chrome stays put.
 *
 * Shaped after the ledger — the portfolio panel across the top, then a card per
 * tranche — and inherited by the screens behind it. Every figure on that page
 * is derived from the whole ledger rather than counted per row, so this is a
 * genuine wait rather than a precaution.
 *
 * Three tones in the same order as everywhere else in the portal: strongest for
 * a figure, middle for a label, faintest for what sits behind both.
 */
export default function FundingLoading() {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* Everything received: sent, received, allocated, left to spend. The
          hairline grid is the real panel's own — a gap-px grid over `ink-line`,
          so the four cells are divided here exactly as they will be. */}
      <section className="skeleton-tile card mb-5">
        <header className="border-b border-ink-line px-5 py-4">
          <div className="h-4 w-40 rounded bg-wash-strong" />
          <div className="mt-2 h-3 w-48 max-w-full rounded bg-wash" />
        </header>

        <dl className="grid gap-px bg-ink-line sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-card px-5 py-4">
              <div className="h-2.5 w-20 rounded bg-wash" />
              <div className="mt-2.5 h-4 w-28 rounded bg-wash-strong" />
            </div>
          ))}
        </dl>
      </section>

      {/* Three tranches. Whatever the ledger holds, a card is tall enough that
          three fills the screen and a fourth would only add grey. */}
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="skeleton-tile card p-5"
            style={{ "--tile": i + 1 } as React.CSSProperties}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="h-4 w-24 rounded bg-wash-strong" />
                  {/* The standing chip, which is a pill on the real card. */}
                  <div className="h-4 w-16 rounded-full bg-wash" />
                </div>
                <div className="mt-2 h-2.5 w-44 max-w-full rounded bg-wash" />
              </div>
              <div className="ml-auto w-36 max-w-full">
                <div className="ml-auto h-4 w-full rounded bg-wash" />
                <div className="ml-auto mt-1.5 h-2.5 w-24 rounded bg-wash-soft" />
              </div>
            </div>

            {/* The drawdown bar, at the real one's height and radius — its own
                empty track is `wash-strong` too, a shade paler than a skeleton
                deepens it to. So this is very nearly not a stand-in at all,
                which is why the bar under a loading tranche looks so settled. */}
            <div className="mt-4 h-3 rounded-full bg-wash-strong" />

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {[0, 1].map((j) => (
                <div key={j} className="h-2.5 w-24 rounded bg-wash-soft" />
              ))}
            </div>

            <div className="mt-3.5 flex items-baseline justify-between gap-x-5 border-t border-ink-line pt-3">
              <div className="h-2.5 w-40 max-w-full rounded bg-wash" />
              <div className="h-2.5 w-20 rounded bg-wash-soft" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
