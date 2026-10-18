import { redirect } from "next/navigation";

// The sign-in form is the home page now; keep old /login links (and their ?next=) working.
export default async function LoginRedirect({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  redirect(next ? `/?next=${encodeURIComponent(next)}` : "/");
}
