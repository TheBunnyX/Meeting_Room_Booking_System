/** The public address of the site, used for canonical links, the sitemap, and social previews. */
export function siteUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  // Set by Vercel to the production domain, so previews of the real site get correct links too.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE_NAME = "MeetingHub";
export const SITE_DESCRIPTION =
  "Find and book the right meeting room for your team: check availability, reserve rooms, and check in with a QR code.";
