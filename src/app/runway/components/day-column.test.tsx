import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DayColumn } from "./day-column";
import type { DayItem } from "../types";

function createDay(overrides: Partial<DayItem> = {}): DayItem {
  return {
    date: "2026-04-06",
    label: "Mon 4/6",
    items: [],
    ...overrides,
  };
}

describe("DayColumn", () => {
  it("renders the day label", () => {
    render(<DayColumn day={createDay()} />);
    expect(screen.getByText("Mon 4/6")).toBeInTheDocument();
  });

  it("renders items with title, account, and type", () => {
    render(
      <DayColumn
        day={createDay({
          items: [
            { title: "CDS Review", account: "Convergix", type: "review" },
          ],
        })}
      />
    );
    expect(screen.getByText("CDS Review")).toBeInTheDocument();
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
  });

  it("renders owner when present", () => {
    render(
      <DayColumn
        day={createDay({
          items: [
            {
              title: "Kickoff",
              account: "LPPC",
              owner: "Kathy",
              type: "kickoff",
            },
          ],
        })}
      />
    );
    expect(screen.getByText("Kathy")).toBeInTheDocument();
  });

  it("does not render owner when absent", () => {
    render(
      <DayColumn
        day={createDay({
          items: [
            { title: "Solo Item", account: "Test", type: "delivery" },
          ],
        })}
      />
    );
    expect(screen.queryByText("Kathy")).not.toBeInTheDocument();
  });

  it("renders notes when present", () => {
    render(
      <DayColumn
        day={createDay({
          items: [
            {
              title: "Item with notes",
              account: "Test",
              type: "deadline",
              notes: "Important deadline",
            },
          ],
        })}
      />
    );
    expect(screen.getByText("Important deadline")).toBeInTheDocument();
  });

  it("applies today highlight styling when isToday is true", () => {
    const { container } = render(
      <DayColumn day={createDay()} isToday={true} />
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("border-sky-500/40");
    expect(wrapper.className).toContain("bg-sky-500/5");
  });

  it("applies default styling when isToday is false", () => {
    const { container } = render(
      <DayColumn day={createDay()} isToday={false} />
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("border-border");
    expect(wrapper.className).toContain("bg-card/50");
  });

  it("shows today indicator dot when isToday", () => {
    const { container } = render(
      <DayColumn day={createDay()} isToday={true} />
    );
    const dot = container.querySelector(".bg-sky-400.rounded-full");
    expect(dot).not.toBeNull();
  });

  it("defaults to non-today styling when isToday omitted", () => {
    const { container } = render(<DayColumn day={createDay()} />);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("border-border");
    expect(wrapper.className).not.toContain("border-sky-500");
  });

  it("does not show today dot when isToday is false", () => {
    const { container } = render(
      <DayColumn day={createDay()} isToday={false} />
    );
    const dot = container.querySelector(".bg-sky-400.rounded-full");
    expect(dot).toBeNull();
  });

  it("renders empty day with no items", () => {
    const { container } = render(<DayColumn day={createDay({ items: [] })} />);
    expect(screen.getByText("Mon 4/6")).toBeInTheDocument();
    // space-y-2 container exists but is empty
    const itemsContainer = container.querySelector(".space-y-2");
    expect(itemsContainer?.children).toHaveLength(0);
  });

  it("renders multiple items", () => {
    render(
      <DayColumn
        day={createDay({
          items: [
            { title: "Item One", account: "A", type: "delivery" },
            { title: "Item Two", account: "B", type: "review" },
            { title: "Item Three", account: "C", type: "kickoff" },
          ],
        })}
      />
    );
    expect(screen.getByText("Item One")).toBeInTheDocument();
    expect(screen.getByText("Item Two")).toBeInTheDocument();
    expect(screen.getByText("Item Three")).toBeInTheDocument();
  });
});
