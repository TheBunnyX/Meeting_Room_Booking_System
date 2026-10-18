import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site";

// Only public pages belong here; everything else needs a sign-in.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${siteUrl()}/login`, changeFrequency: "monthly", priority: 1 }];
}
