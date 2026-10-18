import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/login",
      // Signed-in pages and the API are private; keep crawlers away from them.
      disallow: [
        "/admin",
        "/bookings",
        "/calendar",
        "/policy",
        "/check-in",
        "/check-in-screen",
        "/change-password",
        "/forgot-password",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
