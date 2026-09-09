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

  // Every entry below reached the network before the byte-comparing rewrite:
  // the old guard matched IPv6 by string prefix, so any address spelled a way it
  // had not anticipated was treated as an ordinary public host.
  it("blocks IPv6 spellings of internal addresses that string matching missed", () => {
    for (const h of [
      "[::ffff:a9fe:a9fe]",          // 169.254.169.254 (cloud metadata) in hex-mapped form
      "::ffff:a9fe:a9fe",
      "[::ffff:7f00:1]",             // 127.0.0.1 in hex-mapped form
      "::ffff:0a00:0001",            // 10.0.0.1 in hex-mapped form
      "::ffff:c0a8:0101",            // 192.168.1.1 in hex-mapped form
      "0:0:0:0:0:0:0:1",             // loopback, fully written out
      "0000:0000:0000:0000:0000:0000:0000:0001",
      "0:0:0:0:0:0:0:0",             // unspecified, fully written out
      "[::ffff:0:7f00:1]",           // IPv4-translated ::ffff:0:0:0/96
      "[64:ff9b::7f00:1]",           // NAT64 well-known prefix
      "[::7f00:1]",                  // deprecated IPv4-compatible ::/96
      "fe80:0:0:0:0:0:0:1",          // link-local, written out
      "fcff::1",                     // unique-local, upper half of fc00::/7
      "fdff::1",
      "ff02::1",                     // multicast
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("refuses a colon-bearing host that is not a valid IPv6 literal", () => {
    // A hostname cannot contain a colon, so guessing is never the safe move.
    for (const h of ["::ffff:zzzz", "1:2:3", "12345::1", "::1::2", "1:2:3:4:5:6:7:8:9"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("still allows ordinary public IPv6 addresses", () => {
    for (const h of ["[2606:4700:4700::1111]", "2001:4860:4860::8888", "[::ffff:5db8:d822]"]) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });

  it("blocks multicast and reserved IPv4 space", () => {
    for (const h of ["224.0.0.1", "239.255.255.250", "255.255.255.255", "192.0.0.1"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("refuses a dotted quad with an out-of-range octet", () => {
    expect(isBlockedHost("999.1.1.1")).toBe(true);
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

  it("refuses the metadata endpoint spelled as IPv6", () => {
    expect(isSafeOutboundUrl("https://[::ffff:a9fe:a9fe]/latest/meta-data/")).toBe(false);
    expect(isSafeOutboundUrl("https://[::ffff:7f00:1]:8000/admin")).toBe(false);
    expect(isSafeOutboundUrl("https://[0:0:0:0:0:0:0:1]/admin")).toBe(false);
  });

  it("accepts a public IPv6 host over https", () => {
    expect(isSafeOutboundUrl("https://[2606:4700:4700::1111]/")).toBe(true);
  });

  it("honours requireHttps:false for the http-only callers", () => {
    expect(isSafeOutboundUrl("http://example.com/img.png", { requireHttps: false })).toBe(true);
    expect(isSafeOutboundUrl("http://[::ffff:a9fe:a9fe]/img.png", { requireHttps: false })).toBe(false);
    expect(isSafeOutboundUrl("ftp://example.com/img.png", { requireHttps: false })).toBe(false);
  });
});

