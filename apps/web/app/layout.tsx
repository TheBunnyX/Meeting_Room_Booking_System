import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "../lib/site";
import "./globals.css";

// Self-hosted by Next.js at build time: no render-blocking request to Google Fonts and no layout shift.
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-manrope",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#151515",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE_NAME} | Meeting Room Booking`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: ["meeting room booking", "room reservation", "office meeting rooms", "QR check-in", SITE_NAME],
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  // Everything behind the sign-in is private, so pages are kept out of search results by default.
  // Only the public sign-in page opts back in (see app/login/layout.tsx).
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} | Meeting Room Booking`,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | Meeting Room Booking`,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={manrope.variable}><body>{children}</body></html>;
}
