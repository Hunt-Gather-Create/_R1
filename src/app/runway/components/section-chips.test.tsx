import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReadyToCloseChip, NoScheduledTasksChip } from "./section-chips";

describe("section-chips", () => {
  describe("ReadyToCloseChip", () => {
    it("renders with stable testid for both variants", () => {
      const { rerender } = render(<ReadyToCloseChip variant="light" />);
      expect(screen.getByTestId("ready-to-close-chip")).toBeInTheDocument();
      rerender(<ReadyToCloseChip variant="dark" />);
      expect(screen.getByTestId("ready-to-close-chip")).toBeInTheDocument();
    });

    it("renders the operator-locked label text", () => {
      render(<ReadyToCloseChip variant="light" />);
      expect(screen.getByText("Ready to close?")).toBeInTheDocument();
    });

    it("light variant uses amber palette (no border on light)", () => {
      render(<ReadyToCloseChip variant="light" />);
      const chip = screen.getByTestId("ready-to-close-chip");
      expect(chip.className).toContain("bg-amber-500/20");
      expect(chip.className).toContain("text-amber-400");
      expect(chip.className).not.toContain("border-");
    });

    it("dark variant uses bordered amber palette", () => {
      render(<ReadyToCloseChip variant="dark" />);
      const chip = screen.getByTestId("ready-to-close-chip");
      expect(chip.className).toContain("bg-amber-500/15");
      expect(chip.className).toContain("text-amber-300");
      expect(chip.className).toContain("border-amber-500/40");
    });

    it("defaults to light variant when no prop passed", () => {
      render(<ReadyToCloseChip />);
      const chip = screen.getByTestId("ready-to-close-chip");
      expect(chip.className).toContain("bg-amber-500/20");
    });
  });

  describe("NoScheduledTasksChip", () => {
    it("renders with stable testid for both variants", () => {
      const { rerender } = render(<NoScheduledTasksChip variant="light" />);
      expect(screen.getByTestId("no-scheduled-tasks-chip")).toBeInTheDocument();
      rerender(<NoScheduledTasksChip variant="dark" />);
      expect(screen.getByTestId("no-scheduled-tasks-chip")).toBeInTheDocument();
    });

    it("renders the operator-locked label text", () => {
      render(<NoScheduledTasksChip variant="light" />);
      expect(screen.getByText("No Scheduled Tasks")).toBeInTheDocument();
    });

    it("light variant uses muted-foreground palette", () => {
      render(<NoScheduledTasksChip variant="light" />);
      const chip = screen.getByTestId("no-scheduled-tasks-chip");
      expect(chip.className).toContain("bg-muted");
      expect(chip.className).toContain("text-muted-foreground");
    });

    it("dark variant uses bordered slate palette", () => {
      render(<NoScheduledTasksChip variant="dark" />);
      const chip = screen.getByTestId("no-scheduled-tasks-chip");
      expect(chip.className).toContain("bg-slate-700/50");
      expect(chip.className).toContain("text-slate-300");
      expect(chip.className).toContain("border-slate-600");
    });
  });
});
