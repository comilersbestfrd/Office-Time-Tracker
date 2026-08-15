import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Office Time & Break Tracker",
  description: "Personal dashboard to track check-in, check-out, and washroom/rest breaks, with automatic expected-hours calculation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Adsterra SocialBar */}
        <Script
          id="adsterra-socialbar"
          src="https://pl30780812.effectivecpmnetwork.com/4a/06/b0/4a06b011b3a6976348b4f34ff393dfb0.js"
          strategy="afterInteractive"
        />
        {/* Adsterra Popunder */}
        <Script
          id="adsterra-popunder"
          src="https://pl30780811.effectivecpmnetwork.com/4d/9a/b2/4d9ab233a3f81f4c9d5419764f69bf7f.js"
          strategy="afterInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

