import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "../../lib/site";

// The sign-in page is the one public page, so it is the page search engines index.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to MeetingHub to view your schedule and reserve a meeting room.",
  alternates: { canonical: "/login" },
  robots: { index: true, follow: true },
  openGraph: { url: "/login", title: `Sign in | ${SITE_NAME}` },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
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
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    {children}
  </>;
}
