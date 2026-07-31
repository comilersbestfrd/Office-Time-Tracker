import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}

