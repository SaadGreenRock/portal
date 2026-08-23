"use client";

/**
 * The last resort: a failure in the root layout itself, which the ordinary
 * error boundary sits inside and therefore cannot catch.
 *
 * It has to render its own <html> and <body>, and it cannot rely on the app's
 * stylesheet having loaded — so the few styles it needs are inline. That is the
 * one place in the portal where inline styles are the right answer rather than
 * an oversight.
 *
 * Which is also why this is the one screen that themes itself off
 * prefers-color-scheme rather than off the stored choice. The script that reads
 * that choice lives in the root layout, and the root layout is precisely what
 * failed. So this follows the device: right for anyone who has left the theme
 * control on "match this device", which is where it starts, and wrong only for
 * somebody who overrode it *and* has hit a failure the portal could not start
 * from. A light error page is still a legible error page, and that trade is
 * better than carrying a second copy of the theme machinery into the one file
 * that has to work when nothing else does.
 *
 * The values live in a <style> tag rather than on the elements because an inline
 * style attribute cannot hold a media query.
 */
const CSS = `
:root {
  color-scheme: light;
  --page: #f7f7f5;
  --card: #ffffff;
  --line: #e4e4e4;
  --ink: #1a1a1a;
  --ink-soft: #6b6b6b;
  --ink-faint: #8a8a8a;
  --accent: #104751;
  --accent-text: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --page: #131312;
    --card: #1c1c1a;
    --line: #383834;
    --ink: #ececea;
    --ink-soft: #9a9a95;
    --ink-faint: #7a7a75;
    --accent: #4fb3a1;
    --accent-text: #06251f;
  }
}
`;

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  /**
   * Next hands one down, and this is the one boundary that deliberately does not
   * use it — see the note on the button below. Kept in the type so the contract
   * with the framework stays visible rather than looking like an omission.
   */
  reset?: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "2rem 1.25rem",
          background: "var(--page)",
          color: "var(--ink)",
          font: "16px/1.6 system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: "30rem",
            textAlign: "center",
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: "12px",
            padding: "2.5rem 1.75rem",
          }}
        >
          <h1 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
            The portal could not start
          </h1>
          <p style={{ margin: "0 0 1.5rem", fontSize: "0.87rem", color: "var(--ink-soft)" }}>
            Something failed before any page could load. Nothing has been lost. If it keeps
            happening, send the reference below to whoever maintains the portal.
          </p>
          <button
            type="button"
            /**
             * A full reload rather than `reset()`.
             *
             * `reset()` re-renders the tree that just failed, and what failed
             * here is the root layout — so there is nothing above it left to
             * re-fetch a working version from, and the retry lands on the same
             * broken render. This boundary also replaces the root layout
             * outright, so there is no router mounted to refresh through the way
             * `Trouble` does. A reload is the only thing here that genuinely
             * starts over.
             */
            onClick={() => window.location.reload()}
            style={{
              font: "inherit",
              fontWeight: 600,
              fontSize: "0.87rem",
              padding: "0.7rem 1.4rem",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              background: "var(--accent)",
              color: "var(--accent-text)",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p
              style={{
                margin: "1.5rem 0 0",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                color: "var(--ink-faint)",
                wordBreak: "break-all",
              }}
            >
              {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
