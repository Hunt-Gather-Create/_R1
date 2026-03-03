import * as dns from "node:dns";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isPrivateOrLocalIp,
  validateUrlForSafeFetch,
} from "./ssrf-utils";

vi.mock("node:dns", () => ({
  promises: {
    lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
  },
}));

describe("isPrivateOrLocalIp", () => {
  it("returns true for 0.0.0.0", () => {
    expect(isPrivateOrLocalIp("0.0.0.0")).toBe(true);
  });

  it("returns true for IPv4 private/loopback/link-local", () => {
    expect(isPrivateOrLocalIp("10.0.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrLocalIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("169.254.1.1")).toBe(true);
  });

  it("returns false for public IPv4", () => {
    expect(isPrivateOrLocalIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrLocalIp("93.184.216.34")).toBe(false);
  });

  it("returns true for IPv6 loopback and link-local", () => {
    expect(isPrivateOrLocalIp("::1")).toBe(true);
    expect(isPrivateOrLocalIp("fe80::1")).toBe(true);
    expect(isPrivateOrLocalIp("fc00::1")).toBe(true);
    expect(isPrivateOrLocalIp("fd00::1")).toBe(true);
  });

  it("returns true for IPv4-mapped private", () => {
    expect(isPrivateOrLocalIp("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("validateUrlForSafeFetch", () => {
  const dnsLookup = vi.mocked(dns.promises.lookup);

  beforeEach(() => {
    dnsLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as dns.LookupAddress[]);
  });

  it("returns ok with parsed URL for valid https URL", async () => {
    const result = await validateUrlForSafeFetch("https://example.com/path");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.origin).toBe("https://example.com");
    }
  });

  it("returns invalid_scheme for file URL", async () => {
    const result = await validateUrlForSafeFetch("file:///etc/passwd");
    expect(result).toEqual({ ok: false, reason: "invalid_scheme" });
  });

  it("returns credentials_forbidden for URL with user:pass", async () => {
    const result = await validateUrlForSafeFetch("https://user:pass@example.com");
    expect(result).toEqual({ ok: false, reason: "credentials_forbidden" });
  });

  it("returns disallowed_port for non-80/443 port", async () => {
    const result = await validateUrlForSafeFetch("https://example.com:8080");
    expect(result).toEqual({ ok: false, reason: "disallowed_port" });
  });

  it("returns private_or_local_ip when DNS resolves to 127.0.0.1", async () => {
    (
      dnsLookup as unknown as { mockResolvedValueOnce: (v: dns.LookupAddress[]) => void }
    ).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const result = await validateUrlForSafeFetch("https://evil.example.com");
    expect(result).toEqual({ ok: false, reason: "private_or_local_ip" });
  });
});
