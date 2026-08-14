/**
 * Shown when a module's tables don't exist in the active database.
 *
 * The alternative — a blank server-error page — gives nothing to act on and
 * looks identical to the app being broken. This names the cause and says
 * plainly that the rest of the portal is fine, because the first fear on seeing
 * an error page is that data has been lost.
 *
 * The migration steps are folded away rather than led with. Whoever is covering
 * the desk this month cannot act on "open the Supabase dashboard and run this
 * SQL", and should not: it is a production database one paste away from
 * somebody who was trying to file a receipt. So the face of the screen says who
 * to ask, and the instructions stay one click down for the person who is
 * actually going to run them.
 */
export default function ModuleUnavailable({ module }: { module: string }) {
  return (
    <div className="card mx-auto max-w-xl px-6 py-10 text-center">
      <h1 className="text-[17px] font-semibold">{module} is not switched on yet</h1>

      <p className="mx-auto mt-2.5 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
        This section needs to be set up on the database before it can be used. Ask whoever
        maintains the portal to enable it.
      </p>

      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
        <strong className="font-semibold text-ink">Nothing is wrong with your data</strong>, and
        every other part of the portal works as normal.
      </p>

      <details className="mt-7 text-left">
        <summary className="cursor-pointer text-[12.5px] text-ink-soft hover:text-ink">
          Setup instructions (for whoever maintains the portal)
        </summary>

        <ol className="mt-3 space-y-1.5 text-[13.5px] leading-relaxed text-ink-soft">
          <li>
            <span className="font-medium text-ink">1.</span> Open the Supabase dashboard for this
            project and go to the <span className="font-medium text-ink">SQL Editor</span>.
          </li>
          <li>
            <span className="font-medium text-ink">2.</span> Paste the contents of{" "}
            <code className="rounded bg-[#f4f4f2] px-1.5 py-0.5 font-mono text-[12.5px] text-ink">
              supabase/migration.sql
            </code>{" "}
            and press <span className="font-medium text-ink">Run</span>.
          </li>
          <li>
            <span className="font-medium text-ink">3.</span> Reload this page. Give it half a
            minute if it still complains — Supabase caches its schema briefly.
          </li>
        </ol>

        <p className="mt-3 text-[12.5px] text-ink-soft">
          The migration is safe to re-run and never touches existing records.
        </p>
      </details>
    </div>
  );
}
