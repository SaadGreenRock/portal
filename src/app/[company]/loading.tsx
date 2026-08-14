/**
 * Shown while a workspace screen is fetching.
 *
 * The overview alone runs eight queries before it can render anything, and on a
 * cold serverless request that is a visible pause. A screen that does nothing
 * invites a second click, which is why this exists at all — it is feedback, not
 * decoration.
 *
 * Deliberately a grey wash of the shape that is coming rather than a spinner:
 * it tells you what is arriving, and it does not move, so it cannot be mistaken
 * for progress that has stalled.
 *
 * Three tones, and it is the order of them that does the work rather than the
 * values: strongest for a heading, middle for body, faintest for a list. Taken
 * from the wash scale so the same three steps invert together in the dark
 * theme — a skeleton is the one screen with nothing on it to say which way up
 * the page is, so a bar that stayed pale would be the brightest thing on it.
 */
export default function WorkspaceLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="mb-6">
        <div className="h-6 w-48 rounded bg-wash-strong" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-wash" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <section key={i} className="card flex flex-col gap-3 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="h-4 w-32 rounded bg-wash-strong" />
              <div className="h-3 w-12 rounded bg-wash" />
            </div>
            <div className="h-3 w-full rounded bg-wash" />
            <div className="h-3 w-4/5 rounded bg-wash" />
            <div className="mt-2 space-y-2">
              <div className="h-3 w-full rounded bg-wash-soft" />
              <div className="h-3 w-full rounded bg-wash-soft" />
              <div className="h-3 w-2/3 rounded bg-wash-soft" />
            </div>
            <div className="mt-2 flex gap-2">
              <div className="h-8 w-24 rounded-lg bg-wash-strong" />
              <div className="h-8 w-20 rounded-lg bg-wash" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
