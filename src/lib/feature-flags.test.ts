import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isModalInterceptEnabled } from "./feature-flags";

describe("isModalInterceptEnabled", () => {
  const original = process.env.MODAL_INTERCEPT_ENABLED;

  beforeEach(() => {
    delete process.env.MODAL_INTERCEPT_ENABLED;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.MODAL_INTERCEPT_ENABLED;
    } else {
      process.env.MODAL_INTERCEPT_ENABLED = original;
    }
  });

  it("returns false when env var is unset", () => {
    expect(isModalInterceptEnabled()).toBe(false);
  });

  it("returns false when env var is empty string", () => {
    process.env.MODAL_INTERCEPT_ENABLED = "";
    expect(isModalInterceptEnabled()).toBe(false);
  });

  it("returns true when env var is exactly 'true'", () => {
    process.env.MODAL_INTERCEPT_ENABLED = "true";
    expect(isModalInterceptEnabled()).toBe(true);
  });

  it("returns false for case-mismatched 'TRUE'", () => {
    process.env.MODAL_INTERCEPT_ENABLED = "TRUE";
    expect(isModalInterceptEnabled()).toBe(false);
  });

  it("returns false for '1'", () => {
    process.env.MODAL_INTERCEPT_ENABLED = "1";
    expect(isModalInterceptEnabled()).toBe(false);
  });

  it("returns false for 'false'", () => {
    process.env.MODAL_INTERCEPT_ENABLED = "false";
    expect(isModalInterceptEnabled()).toBe(false);
  });
});
