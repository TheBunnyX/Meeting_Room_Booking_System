import type { Api } from "./router";

let api: Promise<Api> | undefined;

/**
 * Stands in for fetch(): sends the request to the in-browser API. The API (and the validation library it needs)
 * is loaded on the first call, so it stays out of the code that renders the first screen.
 */
export async function localFetch(path: string, init: { method?: string; json?: unknown; body?: BodyInit | null } = {}) {
  api ??= import("./router").then((module) => module.createApi());
  return (await api).request(init.method ?? "GET", path, init);
}
