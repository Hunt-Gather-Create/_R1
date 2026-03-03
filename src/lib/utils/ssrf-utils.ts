/**
 * SSRF validation utilities for safe server-side fetches.
 * Validates URL scheme, credentials, ports, and resolves DNS to block private/loopback/link-local IPs.
 */

import * as dns from "node:dns";

const dnsPromises = dns.promises;

const DEFAULT_ALLOWED_PORTS = new Set([80, 443]);

export type SsrfValidationOk = { ok: true; parsed: URL };
export type SsrfValidationFail = { ok: false; reason: string };
export type SsrfValidationResult = SsrfValidationOk | SsrfValidationFail;

/**
 * Returns true if the IP is private, loopback, or link-local (IPv4 or IPv6).
 */
export function isPrivateOrLocalIp(ip: string): boolean {
  if (ip === "0.0.0.0") return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    return isPrivateOrLocalIp(ip.slice(7));
  }
  const v4 = ip.split(".");
  if (v4.length === 4) {
    const [a, b, c] = v4.map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    return false;
  }
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true; // fe80::/10
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  return false;
}

export interface ValidateUrlForSafeFetchOptions {
  allowedPorts?: Set<number> | number[];
}

/**
 * Validates a URL for safe server-side fetch: http(s) only, no credentials,
 * allowed ports (default 80, 443), and DNS must not resolve to private/loopback/link-local IPs.
 */
export async function validateUrlForSafeFetch(
  url: string,
  options: ValidateUrlForSafeFetchOptions = {}
): Promise<SsrfValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  const scheme = parsed.protocol.replace(/:$/, "");
  if (scheme !== "http" && scheme !== "https") {
    return { ok: false, reason: "invalid_scheme" };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "credentials_forbidden" };
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    return { ok: false, reason: "missing_host" };
  }

  const allowedPorts =
    options.allowedPorts instanceof Set
      ? options.allowedPorts
      : new Set(options.allowedPorts ?? DEFAULT_ALLOWED_PORTS);
  const port = parsed.port
    ? parseInt(parsed.port, 10)
    : scheme === "https"
      ? 443
      : 80;
  if (!allowedPorts.has(port)) {
    return { ok: false, reason: "disallowed_port" };
  }

  try {
    const addresses = await dnsPromises.lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateOrLocalIp(address)) {
        return { ok: false, reason: "private_or_local_ip" };
      }
    }
  } catch {
    return { ok: false, reason: "dns_lookup_failed" };
  }

  return { ok: true, parsed };
}
