"use client";

/**
 * The last resort: a failure in the root layout itself, which the ordinary
 * error boundary sits inside and therefore cannot catch.
 *
 * It has to render its own <html> and <body>, and it cannot rely on the app's
 * stylesheet having loaded — so the few styles it needs are inline. That is the
 * one place in the portal where inline styles are the right answer rather than
 * an oversight.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "2rem 1.25rem",
          background: "#f7f7f5",
          color: "#1a1a1a",
          font: "16px/1.6 system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: "30rem",
            textAlign: "center",
            background: "#fff",
            border: "1px solid #e4e4e4",
            borderRadius: "12px",
            padding: "2.5rem 1.75rem",
          }}
        >
          <h1 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
            The portal could not start
          </h1>
          <p style={{ margin: "0 0 0.6rem", fontSize: "0.87rem", color: "#6b6b6b" }}>
            Something failed before any page could load. Nothing has been lost — this is a
            problem starting the portal, not with the records inside it.
          </p>
          <p style={{ margin: "0 0 1.5rem", fontSize: "0.87rem", color: "#6b6b6b" }}>
            Try again, and if it keeps happening send the reference below to whoever maintains
            the portal.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: "inherit",
              fontWeight: 600,
              fontSize: "0.87rem",
              padding: "0.7rem 1.4rem",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              background: "#104751",
              color: "#fff",
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
                color: "#8a8a8a",
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
