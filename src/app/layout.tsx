import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Port A Boat Rentals – Book Online", template: "%s · Port A Boat Rentals" },
  description: "Premium tritoon pontoon rentals on the bay in Port Aransas, Texas. Book online in minutes.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1E6286" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Maven+Pro:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
