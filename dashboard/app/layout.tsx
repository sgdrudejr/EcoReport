import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ExperimentalUiProvider } from "@/components/ExperimentalUiProvider";
import MainNav from "@/components/MainNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EcoReport",
  description: "Mobile-first portfolio intelligence dashboard for EcoReport",
};

export const viewport: Viewport = {
  width: 1280,
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="theme-light min-h-full overflow-x-auto bg-[#f1f3f5] text-slate-900">
        <ExperimentalUiProvider>
          <MainNav />
          <div className="relative flex min-h-full flex-col">
            {children}
          </div>
        </ExperimentalUiProvider>
      </body>
    </html>
  );
}
