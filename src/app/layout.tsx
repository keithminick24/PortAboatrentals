import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Port A Boat Rentals – Book Online", template: "%s · Port A Boat Rentals" },
  description: "Premium tritoon pontoon rentals on the bay in Port Aransas, Texas. Book online in minutes.",
  icons: { icon: "/brand/logo.png", apple: "/brand/logo.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0B2E4F" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Public+Sans:wght@300;400;500;600;700&family=Inter:wght@500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
