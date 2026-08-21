/**
 * Shown while a food screen is fetching.
 *
 * The section's shell — its title, its tabs, New entry and the way back — lives
 * in the layout, so this stands in for the page alone and the chrome around it
 * never blinks. That is the whole reason /food gets a file here and the two
 * screens that carry their own headers get a boundary inside the page instead.
 *
 * Shaped after the log, which is the section's index, the screen most arrived
 * at and the one that actually queries: four figures, the filter row, then
 * entries. The four screens behind it — an entry, the report, what is
 * outstanding — inherit it, so this is the shape of the section rather than of
 * any one page in it. That is the same bargain the workspace skeleton makes;
 * approximating a list with a list is honest in a way that approximating it
 * with a spinner is not.
 *
 * Three tones, and the order of them does the work rather than the values:
 * strongest for a figure or a name, middle for a label or a line of body,
 * faintest for what sits furthest back. Taken from the wash scale, so all three
 * steps invert together in the dark theme.
 */
export default function FoodLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* Spent to date, owed to vendors, owed to employees, orders pending. */}
      <dl className="card mb-5 grid grid-cols-2 divide-ink-line sm:grid-cols-4 sm:divide-x">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="px-5 py-3.5">
            <div className="h-2.5 w-24 rounded bg-wash" />
            <div className="mt-2.5 h-3.5 w-20 rounded bg-wash-strong" />
          </div>
        ))}
      </dl>

      {/* The filter row: a wide search, then the narrower fields beside it. */}
      <div className="card mb-5 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <div className="h-2.5 w-16 rounded bg-wash" />
            <div className="mt-2 h-10 rounded-lg bg-wash-soft" />
          </div>
          {[0, 1].map((i) => (
            <div key={i}>
              <div className="h-2.5 w-20 rounded bg-wash" />
              <div className="mt-2 h-10 rounded-lg bg-wash-soft" />
            </div>
          ))}
        </div>
      </div>

      {/* Six rows. A page holds more than that, but a skeleton is not a promise
          about how many arrived — six is enough to read as a list and short
          enough not to leave a screen of grey below the fold. */}
      <ul className="space-y-2.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
            <div className="min-w-[7.5rem]">
              <div className="h-3.5 w-24 rounded bg-wash-strong" />
              <div className="mt-1.5 h-2.5 w-16 rounded bg-wash" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="h-3 w-48 max-w-full rounded bg-wash" />
              <div className="mt-1.5 h-2.5 w-32 max-w-full rounded bg-wash-soft" />
            </div>
            <div className="h-3.5 w-24 shrink-0 rounded bg-wash" />
          </li>
        ))}
      </ul>
    </div>
  );
}
