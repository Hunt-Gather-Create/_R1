import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CollapsibleSection } from "./CollapsibleSection";

describe("CollapsibleSection", () => {
  it("renders with open attribute when defaultOpen=true", () => {
    const { container } = render(
      <CollapsibleSection header={<span>Header</span>} defaultOpen={true}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Body content")).toBeTruthy();
  });

  it("renders without open attribute when defaultOpen=false", () => {
    const { container } = render(
      <CollapsibleSection header={<span>Header</span>} defaultOpen={false}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
  });

  it("defaults to open when defaultOpen is omitted", () => {
    const { container } = render(
      <CollapsibleSection header={<span>Header</span>}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const details = container.querySelector("details");
    expect(details!.hasAttribute("open")).toBe(true);
  });

  it("applies custom className to the outer details element", () => {
    const { container } = render(
      <CollapsibleSection header={<span>Header</span>} className="custom-cls">
        <p>Body</p>
      </CollapsibleSection>,
    );
    const details = container.querySelector("details");
    expect(details!.className).toContain("custom-cls");
  });

  it("renders the header slot inside the summary element", () => {
    const { container } = render(
      <CollapsibleSection header={<span data-testid="hdr">My Header</span>}>
        <p>Body</p>
      </CollapsibleSection>,
    );
    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(summary!.querySelector('[data-testid="hdr"]')).not.toBeNull();
    expect(summary!.textContent).toContain("My Header");
  });

  it("renders children inside the body region", () => {
    render(
      <CollapsibleSection header={<span>H</span>}>
        <p data-testid="body-child">Inside body</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("body-child").textContent).toBe("Inside body");
  });
});
