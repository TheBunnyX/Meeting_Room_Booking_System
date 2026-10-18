import { localFetch } from "./local/client";

/** A failed API call, carrying the backend's stable `{ error: { code, message, field } }` shape. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly field: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiOptions = Omit<RequestInit, "body"> & {
  /** Sent as a JSON body. */
  json?: unknown;
  body?: BodyInit | null;
  /** Set to false where a 401 is an expected answer, such as the sign-in form. */
  redirectOnUnauthorized?: boolean;
};

export async function toApiError(response: Response): Promise<ApiError> {
  const fallback = "The request could not be completed.";
  try {
    const data = await response.json();
    const error = data?.error;
    if (error && typeof error.message === "string") {
      return new ApiError(error.message, response.status, String(error.code ?? "ERROR"), error.field ?? null);
    }
  } catch {
    // Non-JSON error bodies (proxies, crashes) fall through to the generic message.
  }
  return new ApiError(fallback, response.status, "ERROR");
}

/**
 * Where to go after signing in. Only same-site paths are accepted, so a crafted link cannot
 * use the sign-in page to bounce someone to another website.
 */
export function safeNextPath(value: string | null | undefined) {
  return value && /^\/(?![/\\])/.test(value) ? value : "/";
}

function redirectTo(path: string) {
  if (typeof window !== "undefined" && window.location.pathname !== path.split("?")[0]) window.location.assign(path);
}

/** The sign-in form (the home page), remembering the page the visitor was trying to open. */
function loginPath() {
  if (typeof window === "undefined") return "/";
  const current = `${window.location.pathname}${window.location.search ?? ""}`;
  return current === "/" ? "/" : `/?next=${encodeURIComponent(current)}`;
}

async function send(path: string, options: ApiOptions): Promise<Response> {
  const { json, redirectOnUnauthorized = true, method, body } = options;
  let response: Response;
  try {
    // The API runs inside the browser (see lib/local), with its data kept in localStorage.
    response = await localFetch(path, { method, json, body });
  } catch {
    throw new ApiError("The request could not be completed. Please try again.", 0, "NETWORK_ERROR");
  }
  if (!response.ok) {
    const error = await toApiError(response);
    if (error.status === 401 && redirectOnUnauthorized) redirectTo(loginPath());
    if (error.code === "PASSWORD_CHANGE_REQUIRED") redirectTo("/change-password");
    throw error;
  }
  return response;
}

/** The single entry point for calling the API. The session is kept by the in-browser API. */
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await send(path, options);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Fetch a file from the API with the session cookie and hand it to the browser as a download. */
export async function apiDownload(path: string, filename: string) {
  const blob = await (await send(path, {})).blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

/** Room images are bundled files (/rooms/...) or absolute Vercel Blob URLs; both are used as they are. */
export function assetUrl(path: string | null | undefined, fallback = "/rooms/studio-01.png") {
  return path || fallback;
}
