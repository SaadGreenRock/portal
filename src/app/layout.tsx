import type { Metadata, Viewport } from "next";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Company Portal",
  description:
    "Payment acknowledgment vouchers and purchase orders for Green Rock and Sportech.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The scan-and-upload step happens on a phone; let it use the whole screen.
  //
  // themeColor is deliberately absent, and so is any theme-color tag in the JSX
  // below. The colour of the phone's own chrome bar has to be decided from the
  // stored choice, which only the script knows — and any tag React renders,
  // whether from a metadata export or written by hand, is React's to reconcile:
  // it puts the rendered value back on hydration and again on every client
  // navigation, undoing the correction. So the tag is created and owned by the
  // script instead, and React never learns about it.
  //
  // The cost is that a browser with JavaScript switched off gets no chrome
  // colour rather than the teal it used to get. That browser cannot run this
  // portal at all, so it is the cheapest thing here to give up.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script below writes `class` and
    // `data-theme` onto this element before React ever sees it, which is the
    // whole point of it running here. Without this, React would report the
    // attributes it did not render as a mismatch and undo them.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Blocking, first thing, and inline.

          The stored theme lives in the browser, so the server cannot render it
          — every screen arrives light and is corrected once JavaScript runs.
          Corrected *after* first paint, that correction is a white flash in a
          dark room, on every navigation. So this one small script runs before
          the browser paints anything, and the page is only ever drawn once.

          Inline rather than a file for the same reason: a separate request is a
          separate chance to be late.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />

        {/*
          The two faces that carry nearly all of the portal's text: 400 is the
          body, 600 is every heading, label, button and figure.

          An @font-face is not discovered until the stylesheet naming it has been
          fetched and parsed, so without these the text that matters most waits a
          full hop behind globals.css — and `font-display: swap` means that hop
          is visible, as a flash of the fallback face reflowing into Poppins.

          Only these two. Medium and Bold are in real use as well, but preloading
          a face is a promise that the first screen needs it; four promises where
          two are true is bandwidth taken from the two that matter.
        */}
        <link
          rel="preload"
          href="/fonts/Poppins-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Poppins-SemiBold.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
