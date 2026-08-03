import type { Metadata, Viewport } from "next";
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
  themeColor: "#104751",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
