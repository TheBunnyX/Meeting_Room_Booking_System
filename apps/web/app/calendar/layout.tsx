import type { Metadata } from "next";

// Page title only: the site is private, so the root layout keeps every page out of search results.
export const metadata: Metadata = { title: "Calendar" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
