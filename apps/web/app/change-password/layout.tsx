import type { Metadata } from "next";

// Page title only: the site is private, so the root layout keeps every page out of search results.
export const metadata: Metadata = { title: "Change password" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
