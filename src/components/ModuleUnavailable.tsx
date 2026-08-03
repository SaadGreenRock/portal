/**
 * Shown when a module's tables don't exist in the active database.
 *
 * The alternative — a blank server-error page — gives the operator nothing to
 * act on and looks identical to the app being broken. This names the cause and
 * the exact fix, and says plainly that the rest of the portal is fine, because
 * the first fear on seeing an error page is that data has been lost.
 */
export default function ModuleUnavailable({ module }: { module: string }) {
  return (
    <div className="card mx-auto max-w-xl px-6 py-10 text-center">
      <h1 className="text-[17px] font-semibold">{module} is not set up on this database yet</h1>

      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
        Its tables are missing, so there is nothing to show. Nothing is wrong with your data and
        the rest of the portal is unaffected.
      </p>

      <div className="mt-5 text-left">
        <p className="label mb-2">To fix it</p>
        <ol className="space-y-1.5 text-[13.5px] leading-relaxed text-ink-soft">
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
      </div>

      <p className="mt-5 text-[12.5px] text-ink-soft">
        The migration is safe to re-run and never touches existing records.
      </p>
    </div>
  );
}
