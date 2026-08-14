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
 */
export default function WorkspaceLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="mb-6">
        <div className="h-6 w-48 rounded bg-[#ececea]" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-[#f1f1ef]" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <section key={i} className="card flex flex-col gap-3 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="h-4 w-32 rounded bg-[#ececea]" />
              <div className="h-3 w-12 rounded bg-[#f1f1ef]" />
            </div>
            <div className="h-3 w-full rounded bg-[#f1f1ef]" />
            <div className="h-3 w-4/5 rounded bg-[#f1f1ef]" />
            <div className="mt-2 space-y-2">
              <div className="h-3 w-full rounded bg-[#f4f4f2]" />
              <div className="h-3 w-full rounded bg-[#f4f4f2]" />
              <div className="h-3 w-2/3 rounded bg-[#f4f4f2]" />
            </div>
            <div className="mt-2 flex gap-2">
              <div className="h-8 w-24 rounded-lg bg-[#ececea]" />
              <div className="h-8 w-20 rounded-lg bg-[#f1f1ef]" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
