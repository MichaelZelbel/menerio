import { describe, expect, it } from "vitest";
import { isBlockedHost, isSafeOutboundUrl } from "../ssrf-guard.ts";

describe("isBlockedHost", () => {
  it("blocks the cloud metadata address", () => {
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(isBlockedHost("metadata.google.internal")).toBe(true);
    expect(isBlockedHost("instance-data")).toBe(true);
  });

  it("blocks loopback, private ranges and CGNAT", () => {
    for (const h of [
      "localhost",
      "app.localhost",
      "printer.local",
      "db.internal",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks an IPv4-mapped IPv6 address pointing somewhere internal", () => {
    expect(isBlockedHost("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows an ordinary public host", () => {
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("93.184.216.34")).toBe(false);
    expect(isBlockedHost("172.32.0.1")).toBe(false); // just outside the private block
  });
});

describe("isSafeOutboundUrl", () => {
  it("refuses non-https schemes", () => {
    expect(isSafeOutboundUrl("http://example.com")).toBe(false);
    expect(isSafeOutboundUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeOutboundUrl("data:text/html,hi")).toBe(false);
  });

  it("refuses embedded credentials", () => {
    expect(isSafeOutboundUrl("https://user:pw@example.com")).toBe(false);
  });

  it("refuses garbage that is not a URL at all", () => {
    expect(isSafeOutboundUrl("not a url")).toBe(false);
    expect(isSafeOutboundUrl("")).toBe(false);
  });

  it("refuses internal hosts and accepts public ones", () => {
    expect(isSafeOutboundUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeOutboundUrl("https://localhost:8000/admin")).toBe(false);
    expect(isSafeOutboundUrl("https://example.com/page")).toBe(true);
  });
});
