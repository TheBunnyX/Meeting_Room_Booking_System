/**
 * The address people use to reach this site, for links that are shown or printed and opened on other
 * devices. A configured public address wins; otherwise the address the page was opened from is used.
 */
export function appOrigin(configured: string | undefined, current: string | undefined) {
  return (configured?.trim() || current || "").replace(/\/+$/, "");
}

/** Whether an address only works on the computer it was opened on. */
export function isLoopbackOrigin(origin: string) {
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}
