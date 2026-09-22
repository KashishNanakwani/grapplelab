import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { TimezoneSync } from "./_components/timezone-sync";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GrappleLab",
  description: "Spaced repetition for Brazilian Jiu-Jitsu.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* Records the browser's timezone so streak days use the user's
            midnight, not UTC. Renders nothing; no-ops when signed out. */}
        <TimezoneSync />
        {children}
      </body>
    </html>
  );
}
