import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Payment Acknowledgment Vouchers",
  description: "Generate, track and archive signed payment acknowledgment vouchers.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The scan-and-upload step happens on a phone; let it use the whole screen.
  themeColor: "#104751",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
