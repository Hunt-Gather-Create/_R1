import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { useActionStateMock } = vi.hoisted(() => ({
  useActionStateMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useActionState: useActionStateMock };
});

vi.mock("./actions", () => ({ verifyAndSetRunwayAuth: vi.fn() }));

import AuthForm from "./auth-form";

describe("AuthForm", () => {
  beforeEach(() => {
    useActionStateMock.mockReset();
  });

  it("renders error alert when the server action returned { error }", () => {
    useActionStateMock.mockReturnValue([
      { error: "Incorrect password." },
      vi.fn(),
      false,
    ]);

    render(<AuthForm returnTo="/runway" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect password.");
  });

  it("disables the submit button and shows the pending label while submitting", () => {
    useActionStateMock.mockReturnValue([null, vi.fn(), true]);

    render(<AuthForm returnTo="/runway" />);

    const submit = screen.getByRole("button", { name: /verifying/i });
    expect(submit).toBeDisabled();
  });

  it("renders no alert and an enabled submit button in the idle state", () => {
    useActionStateMock.mockReturnValue([null, vi.fn(), false]);

    render(<AuthForm returnTo="/runway/foo" />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled();
  });

  it("threads returnTo into the hidden form field", () => {
    useActionStateMock.mockReturnValue([null, vi.fn(), false]);

    const { container } = render(<AuthForm returnTo="/runway/foo" />);
    const hidden = container.querySelector(
      'input[name="returnTo"]',
    ) as HTMLInputElement | null;

    expect(hidden?.value).toBe("/runway/foo");
  });
});
