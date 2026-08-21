/**
 * Shown while a workspace screen is fetching.
 *
 * The overview alone runs eight queries before it can render anything, and on a
 * cold serverless request that is a visible pause. A screen that does nothing
 * invites a second click, which is why this exists at all — it is feedback, not
 * decoration.
 *
 * Deliberately a grey wash of the shape that is coming rather than a spinner:
 * it tells you what is arriving, which a turning ring cannot.
 *
 * The whole block breathes, once and together — see `.skeleton` in globals.css.
 * This used to argue for stillness on the grounds that a moving indicator can be
 * mistaken for progress that has stalled, and that is a real risk, but it belongs
 * to indicators which claim to measure something. A pulse measures nothing and
 * never fills: it cannot be read as four fifths done and stuck, only as a screen
 * still working. Perfectly still, this page had the opposite problem — on a long
 * wait it read as a render that had finished and come out blank.
 *
 * One animation for the screen, rather than the light per card this was first
 * built as. That version cost a promoted layer and a redrawn gradient per card
 * at the exact moment the route behind it was hydrating, and the stagger that
 * made it a wave was also what made every card flash a still stripe before its
 * turn came. The note in globals.css has the whole of it.
 *
 * Three tones, and it is the order of them that does the work rather than the
 * values: strongest for a heading, middle for body, faintest for a list. Taken
 * from the wash scale so the same three steps invert together in the dark
 * theme — a skeleton is the one screen with nothing on it to say which way up
 * the page is, so a bar that stayed pale would be the brightest thing on it.
 */
export default function WorkspaceLoading() {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="mb-6">
        <div className="h-6 w-48 rounded bg-wash-strong" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-wash" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <section
            key={i}
            className="card flex flex-col gap-3 p-5"
          >
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
