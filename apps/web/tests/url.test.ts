import { describe, expect, it } from "vitest";
import { appOrigin, isLoopbackOrigin } from "../lib/url";

describe("appOrigin", () => {
  it("prefers the configured public address and drops trailing slashes", () => {
    expect(appOrigin("https://rooms.example.com/", "http://localhost:3002")).toBe("https://rooms.example.com");
  });

  it("falls back to the address the page was opened from", () => {
    expect(appOrigin(undefined, "http://localhost:3002")).toBe("http://localhost:3002");
    expect(appOrigin("   ", "https://rooms.example.com")).toBe("https://rooms.example.com");
  });

  it("is empty when neither is known", () => {
    expect(appOrigin(undefined, undefined)).toBe("");
  });
});

describe("isLoopbackOrigin", () => {
  it("flags addresses that only work on the same computer", () => {
    expect(isLoopbackOrigin("http://localhost:3002")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isLoopbackOrigin("http://[::1]:3000")).toBe(true);
    expect(isLoopbackOrigin("http://rooms.localhost")).toBe(true);
  });

  it("accepts real addresses and ignores junk", () => {
    expect(isLoopbackOrigin("https://rooms.example.com")).toBe(false);
    expect(isLoopbackOrigin("http://192.168.1.20:3000")).toBe(false);
    expect(isLoopbackOrigin("")).toBe(false);
  });
});
