import type { Metadata } from "next";
import { HomeGate } from "./components/HomeGate";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "../lib/site";

// The home page is the one public page (it shows the sign-in form), so it is the page search engines index.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: { url: "/" },
};

export default function HomePage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: siteUrl(),
    description: SITE_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any",
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\u003c") }} />
    <HomeGate />
  </>;
}
