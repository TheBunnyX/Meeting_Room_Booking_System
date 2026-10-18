import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, assetUrl, errorMessage, safeNextPath } from "../lib/api";

// apiFetch talks to the in-browser API through localFetch; these tests replace it to check what the UI does
// with the answers. The API itself is covered in tests/local.
const localFetch = vi.hoisted(() => vi.fn());
vi.mock("../lib/local/client", () => ({ localFetch }));

function respondWith(body: unknown, status = 200) {
  localFetch.mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

afterEach(() => {
  localFetch.mockReset();
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("sends the method, path and a JSON body to the in-browser API", async () => {
    respondWith({ id: 1 }, 201);

    const result = await apiFetch<{ id: number }>("/api/v1/bookings", { method: "POST", json: { title: "Sync" } });

    expect(result).toEqual({ id: 1 });
    expect(localFetch).toHaveBeenCalledWith("/api/v1/bookings", { method: "POST", json: { title: "Sync" }, body: undefined });
  });

  it("passes uploads through as they are", async () => {
    respondWith({ id: 1 });
    const body = new FormData();

    await apiFetch("/api/v1/rooms/1/image", { method: "POST", body });

    expect(localFetch.mock.calls[0][1].body).toBe(body);
  });

  it("turns the error shape into an ApiError", async () => {
    respondWith({ error: { code: "ROOM_UNAVAILABLE", message: "Room is already booked", field: "starts_at" } }, 409);

    const error = await apiFetch("/api/v1/bookings", { method: "POST", json: {} }).catch((reason) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "ROOM_UNAVAILABLE", message: "Room is already booked", field: "starts_at" });
  });

  it("falls back to a generic message for non-JSON errors", async () => {
    localFetch.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));

    const error = await apiFetch("/api/v1/rooms").catch((reason) => reason);

    expect(error).toMatchObject({ status: 502, code: "ERROR", message: "The request could not be completed." });
  });

  it("reports a failure to run the request as a network error", async () => {
    localFetch.mockRejectedValue(new Error("chunk failed to load"));

    const error = await apiFetch("/api/v1/rooms").catch((reason) => reason);

    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("sends signed-out visitors to the sign-in page unless told not to", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/bookings", assign } });
    respondWith({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue", field: null } }, 401);

    await apiFetch("/api/v1/bookings/my").catch(() => undefined);
    // The page being opened is remembered so signing in can return to it.
    expect(assign).toHaveBeenCalledWith("/login?next=%2Fbookings");

    assign.mockClear();
    respondWith({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password", field: null } }, 401);
    await apiFetch("/api/v1/auth/login", { method: "POST", json: {}, redirectOnUnauthorized: false }).catch(() => undefined);
    expect(assign).not.toHaveBeenCalled();
  });

  it("sends users with a temporary password to the change-password page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/", assign } });
    respondWith({ error: { code: "PASSWORD_CHANGE_REQUIRED", message: "Change your temporary password", field: null } }, 403);

    await apiFetch("/api/v1/rooms").catch(() => undefined);

    expect(assign).toHaveBeenCalledWith("/change-password");
  });
});

describe("sign-in return path", () => {
  it("remembers the query string, such as a scanned check-in code", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/check-in", search: "?room=3", assign } });
    respondWith({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue", field: null } }, 401);

    await apiFetch("/api/v1/rooms/3/check-in", { method: "POST" }).catch(() => undefined);

    expect(assign).toHaveBeenCalledWith("/login?next=%2Fcheck-in%3Froom%3D3");
  });

  it("goes to the plain sign-in page from the home page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/", search: "", assign } });
    respondWith({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue", field: null } }, 401);

    await apiFetch("/api/v1/auth/me").catch(() => undefined);

    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("only accepts paths on this site", () => {
    expect(safeNextPath("/check-in?room=3")).toBe("/check-in?room=3");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});

describe("errorMessage", () => {
  it("prefers the API message and otherwise uses the fallback", () => {
    expect(errorMessage(new ApiError("Email already exists", 409, "EMAIL_TAKEN", "email"), "Fallback")).toBe("Email already exists");
    expect(errorMessage(new Error("boom"), "Fallback")).toBe("Fallback");
  });
});

describe("assetUrl", () => {
  it("leaves bundled, uploaded and external images alone and falls back when missing", () => {
    const uploaded = "data:image/jpeg;base64,/9j/4AAQ";
    expect(assetUrl("/rooms/the-loft.png")).toBe("/rooms/the-loft.png");
    expect(assetUrl(uploaded)).toBe(uploaded);
    expect(assetUrl("https://cdn.example.com/room.png")).toBe("https://cdn.example.com/room.png");
    expect(assetUrl(null)).toBe("/rooms/studio-01.png");
  });
});
