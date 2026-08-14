import Link from "next/link";

/**
 * The one screen for "this did not work", used by every error boundary and by
 * the 404.
 *
 * Written for whoever is at the desk, which is not always whoever set the
 * portal up. Three things, in this order, because they are the order the
 * questions arrive in: what happened, whether the records are safe, and what to
 * press next. The reassurance is not padding — the first fear on meeting an
 * error page in a system that holds the only copy of the paperwork is that the
 * paperwork is gone.
 *
 * No technical detail on the face of it. A digest or a stack trace tells the
 * person reading it nothing they can act on, and reads as "you broke it". It
 * goes in the fold at the bottom instead, where it can be copied into a message
 * to whoever maintains this.
 */
export default function Trouble({
  title,
  children,
  detail,
  retry,
  home = { href: "/", label: "Go to the company picker" },
}: {
  title: string;
  /** One or two sentences: what happened, and what it means for the records. */
  children: React.ReactNode;
  /** Error digest or message — folded away, for passing on rather than reading. */
  detail?: string | null;
  /** Re-runs the failed render. Omitted on a 404, where there is nothing to retry. */
  retry?: () => void;
  home?: { href: string; label: string };
}) {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-xl flex-col justify-center px-5 py-12">
      <div className="card px-6 py-10 text-center sm:px-8">
        <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>

        <div className="mx-auto mt-2.5 max-w-md space-y-2 text-[13.5px] leading-relaxed text-ink-soft">
          {children}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {retry ? (
            <button type="button" onClick={retry} className="btn btn-primary">
              Try again
            </button>
          ) : null}
          <Link href={home.href} className={retry ? "btn btn-ghost" : "btn btn-primary"}>
            {home.label}
          </Link>
        </div>

        {detail ? (
          <details className="mt-7 text-left">
            <summary className="cursor-pointer text-[12.5px] text-ink-soft hover:text-ink">
              Technical details
            </summary>
            <p className="mt-2 break-all rounded-lg bg-page px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink-soft">
              {detail}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
              Send this line to whoever maintains the portal. It identifies the failure in the
              server logs.
            </p>
          </details>
        ) : null}
      </div>
    </div>
  );
}
