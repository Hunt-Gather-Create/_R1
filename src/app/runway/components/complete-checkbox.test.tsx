import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const setWeekItemStatusAction = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), {
  error: vi.fn(),
  success: vi.fn(),
}));
const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("../actions", () => ({
  setWeekItemStatusAction: (input: unknown) => setWeekItemStatusAction(input),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import { CompleteCheckbox } from "./complete-checkbox";

const NAME_COOKIE = "runway_editor_name";

function seedEditorName(name: string) {
  document.cookie = `${NAME_COOKIE}=${encodeURIComponent(name)}; Path=/`;
}

function clearEditorName() {
  document.cookie = `${NAME_COOKIE}=; Path=/; Max-Age=0`;
}

describe("CompleteCheckbox", () => {
  beforeEach(() => {
    setWeekItemStatusAction.mockReset();
    toast.mockReset();
    toast.error.mockReset();
    toast.success.mockReset();
    routerRefresh.mockReset();
    // Default each test to a seeded name so the existing assertions stay
    // single-step (click → action fires). The name-prompt branch has its
    // own dedicated tests below that clear the cookie first.
    seedEditorName("Jason");
  });

  it("renders null when weekItemId is missing", () => {
    const { container } = render(
      <CompleteCheckbox weekItemId={undefined} title="X" status={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders null when the row is already terminal (status=completed)", () => {
    const { container } = render(
      <CompleteCheckbox weekItemId="w1" title="X" status="completed" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders null when the row is canceled", () => {
    const { container } = render(
      <CompleteCheckbox weekItemId="w1" title="X" status="canceled" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders an unchecked checkbox with the correct aria-label for an open item", () => {
    render(
      <CompleteCheckbox weekItemId="w1" title="Design comps" status="in-progress" />,
    );
    const box = screen.getByTestId("complete-checkbox");
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(box).toHaveAttribute("aria-label", "Mark Design comps complete");
    expect(box).toHaveAttribute("role", "checkbox");
  });

  it("optimistically flips to checked on click and fires the server action with editorName + newStatus=completed", async () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: true,
      previousStatus: "in-progress",
    });
    render(
      <CompleteCheckbox weekItemId="w1" title="Design comps" status="in-progress" />,
    );
    const box = screen.getByTestId("complete-checkbox");
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "true");
    await waitFor(() => {
      expect(setWeekItemStatusAction).toHaveBeenCalledWith({
        weekItemId: "w1",
        newStatus: "completed",
        editorName: "Jason",
      });
    });
  });

  it("fires sonner toast with an Undo action after a successful complete", async () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: true,
      previousStatus: "in-progress",
    });
    render(
      <CompleteCheckbox weekItemId="w1" title="Design comps" status="in-progress" />,
    );
    fireEvent.click(screen.getByTestId("complete-checkbox"));
    await waitFor(() => {
      expect(toast).toHaveBeenCalled();
    });
    const [message, options] = toast.mock.calls[0] as [string, { action?: { label: string; onClick: () => void } }];
    expect(message).toBe("Design comps marked complete");
    expect(options.action?.label).toBe("Undo");
  });

  it("Undo invokes the server action with newStatus=previousStatus and threads the same editorName", async () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: true,
      previousStatus: "at-risk",
    });
    render(
      <CompleteCheckbox weekItemId="w1" title="Design comps" status="at-risk" />,
    );
    fireEvent.click(screen.getByTestId("complete-checkbox"));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const [, options] = toast.mock.calls[0] as [string, { action: { onClick: () => void } }];
    setWeekItemStatusAction.mockClear();
    setWeekItemStatusAction.mockResolvedValue({ ok: true, previousStatus: "completed" });
    options.action.onClick();
    await waitFor(() => {
      expect(setWeekItemStatusAction).toHaveBeenLastCalledWith({
        weekItemId: "w1",
        newStatus: "at-risk",
        editorName: "Jason",
      });
    });
    // Visual reverts to unchecked.
    expect(screen.getByTestId("complete-checkbox")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("reverts optimistic state and fires error toast when the server action fails", async () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: false,
      error: "validator rejected",
    });
    render(
      <CompleteCheckbox weekItemId="w1" title="Design comps" status={null} />,
    );
    const box = screen.getByTestId("complete-checkbox");
    fireEvent.click(box);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Could not mark complete: validator rejected",
        { id: "checkbox-w1" },
      );
    });
    expect(box).toHaveAttribute("aria-checked", "false");
  });

  it("Enter and Space activate the checkbox like Click", async () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: true,
      previousStatus: null,
    });
    render(
      <CompleteCheckbox weekItemId="w1" title="Maintenance" status={null} />,
    );
    const box = screen.getByTestId("complete-checkbox");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(setWeekItemStatusAction).toHaveBeenCalledTimes(1),
    );
  });

  it("ignores re-clicks once the box is optimistically completed (no phantom undo)", async () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: true,
      previousStatus: "in-progress",
    });
    render(
      <CompleteCheckbox weekItemId="w1" title="Design comps" status="in-progress" />,
    );
    const box = screen.getByTestId("complete-checkbox");
    fireEvent.click(box);
    await waitFor(() =>
      expect(setWeekItemStatusAction).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(box);
    fireEvent.click(box);
    // Still exactly one server call — the second + third clicks fall
    // through the optimistic-completed guard, so no phantom-undo toast
    // gets queued behind the real one.
    expect(setWeekItemStatusAction).toHaveBeenCalledTimes(1);
  });

  // #79 — checkbox undo visual stuck because revalidatePath only marks the
  // RSC cache stale on the server; without router.refresh() the client never
  // refetches and the card stays visually checked even after Undo writes back.
  it("does NOT call router.refresh on initial click (preserves the 8s undo window without flickering the card out of view)", async () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: true,
      previousStatus: "in-progress",
    });
    render(
      <CompleteCheckbox weekItemId="w1" title="Design comps" status="in-progress" />,
    );
    fireEvent.click(screen.getByTestId("complete-checkbox"));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("calls router.refresh after a successful Undo so prop-derived state catches up to the optimistic state", async () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: true,
      previousStatus: "at-risk",
    });
    render(
      <CompleteCheckbox weekItemId="w1" title="Design comps" status="at-risk" />,
    );
    fireEvent.click(screen.getByTestId("complete-checkbox"));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const [, options] = toast.mock.calls[0] as [string, { action: { onClick: () => void } }];
    setWeekItemStatusAction.mockClear();
    setWeekItemStatusAction.mockResolvedValue({ ok: true, previousStatus: "completed" });
    options.action.onClick();
    await waitFor(() => expect(routerRefresh).toHaveBeenCalledTimes(1));
  });

  it("calls router.refresh on toast onAutoClose so the card leaves In Flight when the 8s window expires without Undo", async () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: true,
      previousStatus: "in-progress",
    });
    render(
      <CompleteCheckbox weekItemId="w1" title="Design comps" status="in-progress" />,
    );
    fireEvent.click(screen.getByTestId("complete-checkbox"));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const [, options] = toast.mock.calls[0] as [string, { onAutoClose?: () => void }];
    expect(typeof options.onAutoClose).toBe("function");
    options.onAutoClose!();
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT call router.refresh when Undo's server write itself fails (visual stays checked to match DB)", async () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: true,
      previousStatus: "in-progress",
    });
    render(
      <CompleteCheckbox weekItemId="w1" title="Design comps" status="in-progress" />,
    );
    fireEvent.click(screen.getByTestId("complete-checkbox"));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const [, options] = toast.mock.calls[0] as [string, { action: { onClick: () => void } }];
    setWeekItemStatusAction.mockClear();
    setWeekItemStatusAction.mockResolvedValue({ ok: false, error: "validator rejected" });
    options.action.onClick();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not undo: validator rejected", {
        id: "checkbox-w1",
      }),
    );
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("stops click propagation so the surrounding card doesn't open a modal", () => {
    setWeekItemStatusAction.mockResolvedValue({
      ok: true,
      previousStatus: null,
    });
    const cardClick = vi.fn();
    render(
      <div onClick={cardClick}>
        <CompleteCheckbox weekItemId="w1" title="X" status={null} />
      </div>,
    );
    fireEvent.click(screen.getByTestId("complete-checkbox"));
    expect(cardClick).not.toHaveBeenCalled();
  });

  // #80 — editor-name gate. The dashboard checkbox now mirrors the pencil's
  // useEditorName flow so updateWeekItemField's idem-key is unique per
  // operator + click and doesn't collide on the second click of the same row.
  describe("editor-name gate (#80)", () => {
    it("opens the name prompt instead of firing the action when the cookie is empty", () => {
      clearEditorName();
      setWeekItemStatusAction.mockResolvedValue({
        ok: true,
        previousStatus: "in-progress",
      });
      render(
        <CompleteCheckbox weekItemId="w1" title="Design comps" status="in-progress" />,
      );
      fireEvent.click(screen.getByTestId("complete-checkbox"));
      expect(screen.getByTestId("name-prompt-dialog")).toBeInTheDocument();
      expect(setWeekItemStatusAction).not.toHaveBeenCalled();
      // Visual state stays unchecked until the user actually submits.
      expect(screen.getByTestId("complete-checkbox")).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    it("fires the action with the submitted name once the operator submits the prompt", async () => {
      clearEditorName();
      setWeekItemStatusAction.mockResolvedValue({
        ok: true,
        previousStatus: "in-progress",
      });
      render(
        <CompleteCheckbox weekItemId="w1" title="Design comps" status="in-progress" />,
      );
      fireEvent.click(screen.getByTestId("complete-checkbox"));
      const input = screen.getByTestId("name-prompt-input");
      fireEvent.change(input, { target: { value: "Alice" } });
      fireEvent.click(screen.getByTestId("name-prompt-submit"));
      await waitFor(() => {
        expect(setWeekItemStatusAction).toHaveBeenCalledWith({
          weekItemId: "w1",
          newStatus: "completed",
          editorName: "Alice",
        });
      });
      // The optimistic flip happens after the prompt resolves, not on the
      // initial click.
      expect(screen.getByTestId("complete-checkbox")).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    it("skips the prompt on subsequent clicks once the cookie is populated", async () => {
      seedEditorName("Bob");
      setWeekItemStatusAction.mockResolvedValue({
        ok: true,
        previousStatus: "in-progress",
      });
      render(
        <CompleteCheckbox weekItemId="w1" title="Design comps" status="in-progress" />,
      );
      fireEvent.click(screen.getByTestId("complete-checkbox"));
      // No prompt rendered; action fires directly with the cookie's value.
      expect(screen.queryByTestId("name-prompt-dialog")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(setWeekItemStatusAction).toHaveBeenCalledWith({
          weekItemId: "w1",
          newStatus: "completed",
          editorName: "Bob",
        });
      });
    });
  });
});
