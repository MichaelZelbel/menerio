import { describe, expect, it } from "vitest";
import { isAllowedReturnUrl } from "../return-url.ts";

describe("isAllowedReturnUrl", () => {
  it("accepts the callback page on the app's own sites", () => {
    expect(isAllowedReturnUrl("https://menerio.com/gdrive-callback")).toBe(true);
    expect(isAllowedReturnUrl("https://www.cherishly.ai/gdrive-callback")).toBe(true);
    expect(isAllowedReturnUrl("https://id-preview--d90589e3-d781.lovable.app/gdrive-callback")).toBe(true);
    expect(isAllowedReturnUrl("http://localhost:8080/gdrive-callback")).toBe(true);
  });

  it("refuses any other site, even one that only looks alike", () => {
    expect(isAllowedReturnUrl("https://evil.example/gdrive-callback")).toBe(false);
    expect(isAllowedReturnUrl("https://menerio.com.evil.example/gdrive-callback")).toBe(false);
    expect(isAllowedReturnUrl("https://evilmenerio.com/gdrive-callback")).toBe(false);
    expect(isAllowedReturnUrl("https://a.b.lovable.app/gdrive-callback")).toBe(false);
    expect(isAllowedReturnUrl("https://menerio.com@evil.example/gdrive-callback")).toBe(false);
  });

  it("refuses another page, plain http off localhost, and junk", () => {
    expect(isAllowedReturnUrl("https://menerio.com/dashboard")).toBe(false);
    expect(isAllowedReturnUrl("http://menerio.com/gdrive-callback")).toBe(false);
    expect(isAllowedReturnUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedReturnUrl("not a url")).toBe(false);
  });
});
