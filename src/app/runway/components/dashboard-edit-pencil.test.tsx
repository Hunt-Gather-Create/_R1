import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  act,
  cleanup,
} from "@testing-library/react";

const updateWeekItemFieldsAction = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => ({ ok: true, previousValues: {} })),
);
// Default mock: top-level L1s only. Action filters wrapper-children out
// per P1.2 (TP code-review on 856b7dd); fixture must match the contract
// or it would silently encode the bug.
const listProjectsForWeekItemAction = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => ({
    ok: true as const,
    projects: [
      { id: "p-1", name: "Brand Refresh", parentProjectId: null },
      { id: "p-2", name: "Burger Day LP", parentProjectId: null },
    ],
  })),
);
const toastLoading = vi.hoisted(() => vi.fn(() => "toast-id"));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("../actions", () => ({
  updateWeekItemFieldsAction: (input: unknown) =>
    updateWeekItemFieldsAction(input as never),
  listProjectsForWeekItemAction: (input: unknown) =>
    listProjectsForWeekItemAction(input as never),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    loading: toastLoading,
    success: toastSuccess,
    error: toastError,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import { EditPencil, type EditPencilItem } from "./dashboard-edit-pencil";

function clearCookies() {
  if (typeof document === "undefined") return;
  for (const c of document.cookie.split("; ")) {
    const eq = c.indexOf("=");
    if (eq < 0) continue;
    const key = decodeURIComponent(c.slice(0, eq));
    document.cookie = `${encodeURIComponent(key)}=; Max-Age=0; Path=/`;
  }
}

function makeItem(overrides: Partial<EditPencilItem> = {}): EditPencilItem {
  return {
    id: "wi-1",
    title: "Brand: Hero",
    owner: "Lane",
    resources: "AM: Jill, CD: Mark",
    startDate: "2026-06-01",
    endDate: "2026-06-05",
    status: "in-progress",
    notes: "ready for review",
    category: "delivery",
    parentProjectName: "Brand Refresh",
    projectId: "p-1",
    ...overrides,
  };
}

describe("EditPencil", () => {
  beforeEach(() => {
    updateWeekItemFieldsAction.mockClear();
    listProjectsForWeekItemAction.mockClear();
    toastLoading.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    routerRefresh.mockClear();
    clearCookies();
    cleanup();
  });

  it("renders a pencil button with a descriptive aria-label per item title", () => {
    render(<EditPencil item={makeItem({ title: "Edit me" })} />);
    const pencil = screen.getByTestId("edit-pencil");
    expect(pencil).toBeInTheDocument();
    expect(pencil).toHaveAttribute("aria-label", "Edit Edit me");
    expect(pencil.tagName).toBe("BUTTON");
  });

  // #82 — pencil anchors top-right (was top-left, which overlapped the
  // account label on every card). Card consumers (L2MiniCard,
  // day-item-card) add `pt-6` to their right-column flex so the checkbox
  // sits below this button.
  it("anchors the pencil button at top-right of the card (no overlap with the account label)", () => {
    render(<EditPencil item={makeItem()} />);
    const pencil = screen.getByTestId("edit-pencil");
    const cls = pencil.className;
    expect(cls).toContain("right-1.5");
    expect(cls).toContain("top-1.5");
    expect(cls).not.toContain("left-");
  });

  it("returns null when the item has no id (can't write back without a key)", () => {
    const { container } = render(
      <EditPencil item={{ ...makeItem(), id: "" }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("opens the name-prompt dialog on pencil click when no editor-name cookie is set", async () => {
    render(<EditPencil item={makeItem()} />);
    expect(screen.queryByTestId("name-prompt-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("edit-pencil"));
    expect(screen.getByTestId("name-prompt-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-dialog")).toBeNull();
  });

  it("opens the edit dialog directly when the editor-name cookie is already set", () => {
    document.cookie = `runway_editor_name=${encodeURIComponent("Jason")}; Path=/`;
    render(<EditPencil item={makeItem()} />);
    fireEvent.click(screen.getByTestId("edit-pencil"));
    expect(screen.getByTestId("edit-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("name-prompt-dialog")).toBeNull();
  });

  it("name-prompt submit writes the cookie and advances to the edit dialog", () => {
    render(<EditPencil item={makeItem()} />);
    fireEvent.click(screen.getByTestId("edit-pencil"));
    const input = screen.getByTestId("name-prompt-input");
    fireEvent.change(input, { target: { value: "  Jason Burks  " } });
    fireEvent.click(screen.getByTestId("name-prompt-submit"));
    expect(document.cookie).toContain("runway_editor_name=Jason%20Burks");
    expect(screen.queryByTestId("name-prompt-dialog")).toBeNull();
    expect(screen.getByTestId("edit-dialog")).toBeInTheDocument();
  });

  it("name-prompt submit button stays disabled until the name has non-whitespace content", () => {
    render(<EditPencil item={makeItem()} />);
    fireEvent.click(screen.getByTestId("edit-pencil"));
    expect(screen.getByTestId("name-prompt-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("name-prompt-input"), {
      target: { value: "   " },
    });
    expect(screen.getByTestId("name-prompt-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("name-prompt-input"), {
      target: { value: "J" },
    });
    expect(screen.getByTestId("name-prompt-submit")).not.toBeDisabled();
  });

  describe("edit dialog (cookie pre-set)", () => {
    beforeEach(() => {
      document.cookie = `runway_editor_name=${encodeURIComponent("Jason")}; Path=/`;
    });

    it("pre-fills every field from the item shape", () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      expect(screen.getByTestId("edit-field-title")).toHaveValue("Brand: Hero");
      expect(screen.getByTestId("edit-field-owner")).toHaveValue("Lane");
      // Resources now renders via ResourceChipEditor (chip mode for the
      // canonical "AM: Jill, CD: Mark" form); assert the two chips read
      // back the right role + name rather than a single input value.
      const chipRoles = screen.getAllByTestId("resource-chip-role");
      const chipNames = screen.getAllByTestId("resource-chip-name");
      expect(chipRoles).toHaveLength(2);
      expect((chipRoles[0] as HTMLSelectElement).value).toBe("AM");
      expect((chipNames[0] as HTMLInputElement).value).toBe("Jill");
      expect((chipRoles[1] as HTMLSelectElement).value).toBe("CD");
      expect((chipNames[1] as HTMLInputElement).value).toBe("Mark");
      expect(screen.getByTestId("edit-field-startDate")).toHaveValue(
        "2026-06-01",
      );
      expect(screen.getByTestId("edit-field-endDate")).toHaveValue("2026-06-05");
      expect(screen.getByTestId("edit-field-status")).toHaveValue("in-progress");
      expect(screen.getByTestId("edit-field-notes")).toHaveValue(
        "ready for review",
      );
    });

    // #84 — `week_items.category` (chip enum: delivery / review / etc.)
    // is editable in the modal. Pre-#84 it was a read-only field mislabeled
    // as a cascade from the parent project; the new field is a select
    // dropdown over WEEK_ITEM_CATEGORIES with a (clear) option.
    it("renders category as an editable <select> pre-filled from the WI's category with a (clear) option", () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      const cat = screen.getByTestId("edit-field-category") as HTMLSelectElement;
      expect(cat.tagName).toBe("SELECT");
      expect(cat.value).toBe("delivery");
      const options = Array.from(cat.querySelectorAll("option")).map((o) => o.value);
      expect(options).toEqual([
        "",
        "delivery",
        "review",
        "kickoff",
        "deadline",
        "approval",
        "launch",
      ]);
    });

    it("changing the category dropdown + saving patches the category field through the action", async () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      fireEvent.change(screen.getByTestId("edit-field-category"), {
        target: { value: "review" },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("edit-save"));
        await Promise.resolve();
      });
      expect(updateWeekItemFieldsAction).toHaveBeenCalledTimes(1);
      const call = updateWeekItemFieldsAction.mock.calls[0][0] as {
        fields: Record<string, unknown>;
      };
      expect(call.fields).toEqual({ category: "review" });
    });

    it("selecting (clear) writes null on the patch so the column resets", async () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      fireEvent.change(screen.getByTestId("edit-field-category"), {
        target: { value: "" },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("edit-save"));
        await Promise.resolve();
      });
      expect(updateWeekItemFieldsAction).toHaveBeenCalledTimes(1);
      const call = updateWeekItemFieldsAction.mock.calls[0][0] as {
        fields: Record<string, unknown>;
      };
      expect(call.fields).toEqual({ category: null });
    });

    it("project category field renders read-only beside the editable Category and pre-fills from item.parentCategory", () => {
      // commit 4 (#81) threads parentCategory through; this test pins
      // the read-only contract now so the empty-on-undefined path doesn't
      // regress while the data wiring lands.
      render(
        <EditPencil item={makeItem({ parentCategory: "active" })} />,
      );
      fireEvent.click(screen.getByTestId("edit-pencil"));
      const pc = screen.getByTestId("edit-field-parentCategory");
      expect(pc).toHaveAttribute("readonly");
      expect(pc).toHaveValue("active");
    });

    it("project category field renders empty when parentCategory is undefined (graceful pre-commit-4 state)", () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      const pc = screen.getByTestId("edit-field-parentCategory");
      expect(pc).toHaveAttribute("readonly");
      expect(pc).toHaveValue("");
    });

    it("renders the project field as a <select> pre-filled to item.projectId once options load", async () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      await act(async () => {
        await Promise.resolve();
      });
      const proj = screen.getByTestId("edit-field-project") as HTMLSelectElement;
      expect(proj.tagName).toBe("SELECT");
      expect(proj.value).toBe("p-1");
      const options = Array.from(proj.querySelectorAll("option")).map((o) => ({
        value: o.value,
        label: o.textContent,
      }));
      expect(options).toEqual([
        { value: "p-1", label: "Brand Refresh" },
        { value: "p-2", label: "Burger Day LP" },
      ]);
    });

    it("disables the project <select> with a 'Loading projects…' placeholder while the action is in flight", () => {
      // Make the list action stall so the loading state stays visible.
      listProjectsForWeekItemAction.mockImplementationOnce(
        () => new Promise(() => {}),
      );
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      const proj = screen.getByTestId("edit-field-project") as HTMLSelectElement;
      expect(proj).toBeDisabled();
      expect(proj.querySelector("option")?.textContent).toMatch(/Loading/i);
    });

    // P1.3 from TP code-review on 856b7dd: when the WI's current parent
    // is terminal-status, the server action filters it out. Without
    // surfacing the current parent as a visible (disabled) option, the
    // <select> visually shows the first loaded option while state stays
    // on the missing id — the operator sees a lie. Picker prepends the
    // current parent as a disabled "(current — closed)" option.
    it("includes the current parent as a disabled option when it isn't in the loaded list (terminal status case)", async () => {
      listProjectsForWeekItemAction.mockResolvedValueOnce({
        ok: true as const,
        projects: [
          { id: "p-2", name: "Burger Day LP", parentProjectId: null },
        ],
      });
      render(
        <EditPencil
          item={makeItem({
            projectId: "p-old",
            parentProjectName: "Closed Project",
          })}
        />,
      );
      fireEvent.click(screen.getByTestId("edit-pencil"));
      await act(async () => {
        await Promise.resolve();
      });
      const proj = screen.getByTestId("edit-field-project") as HTMLSelectElement;
      const options = Array.from(proj.querySelectorAll("option")).map((o) => ({
        value: o.value,
        label: o.textContent ?? "",
        disabled: o.hasAttribute("disabled"),
      }));
      expect(options[0]).toEqual({
        value: "p-old",
        label: expect.stringMatching(/Closed Project/),
        disabled: true,
      });
      expect(proj.value).toBe("p-old");
    });

    it("save passes projectId separately from fields when the user picks a different project", async () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.change(screen.getByTestId("edit-field-project"), {
        target: { value: "p-2" },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("edit-save"));
        await Promise.resolve();
      });
      expect(updateWeekItemFieldsAction).toHaveBeenCalledTimes(1);
      const call = updateWeekItemFieldsAction.mock.calls[0][0] as {
        weekItemId: string;
        updatedBy: string;
        fields: Record<string, unknown>;
        projectId?: string;
      };
      expect(call.fields).toEqual({});
      expect(call.projectId).toBe("p-2");
    });

    it("Save button is disabled until a field is dirty", () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      expect(screen.getByTestId("edit-save")).toBeDisabled();
      fireEvent.change(screen.getByTestId("edit-field-owner"), {
        target: { value: "Jill" },
      });
      expect(screen.getByTestId("edit-save")).not.toBeDisabled();
    });

    it("Save button disables when title is cleared (title required)", () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      fireEvent.change(screen.getByTestId("edit-field-title"), {
        target: { value: "" },
      });
      expect(screen.getByTestId("edit-save")).toBeDisabled();
      expect(screen.getByTestId("edit-validation-error")).toHaveTextContent(
        "Title is required",
      );
    });

    it("Save button disables when startDate > endDate", () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      fireEvent.change(screen.getByTestId("edit-field-startDate"), {
        target: { value: "2026-07-01" },
      });
      expect(screen.getByTestId("edit-save")).toBeDisabled();
      expect(screen.getByTestId("edit-validation-error")).toHaveTextContent(
        "Start date must be on or before end date",
      );
    });

    it("Save dispatches updateWeekItemFieldsAction with the cookie-name updatedBy and the dirty patch", async () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      fireEvent.change(screen.getByTestId("edit-field-owner"), {
        target: { value: "Jill" },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("edit-save"));
        await Promise.resolve();
      });
      expect(updateWeekItemFieldsAction).toHaveBeenCalledTimes(1);
      const call = updateWeekItemFieldsAction.mock.calls[0][0] as {
        weekItemId: string;
        updatedBy: string;
        fields: Record<string, unknown>;
      };
      expect(call.weekItemId).toBe("wi-1");
      expect(call.updatedBy).toBe("Jason");
      expect(call.fields).toEqual({ owner: "Jill" });
    });

    it("Save click closes the dialog immediately (optimistic close) before the server returns", () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      fireEvent.change(screen.getByTestId("edit-field-owner"), {
        target: { value: "Jill" },
      });
      fireEvent.click(screen.getByTestId("edit-save"));
      // The dialog is unmounted synchronously on Save click; the server
      // action runs in the background and the toast surfaces the outcome.
      expect(screen.queryByTestId("edit-dialog")).toBeNull();
    });

    it("auto-derives dayOfWeek from startDate when startDate changes", () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      // 2026-06-03 is a Wednesday (UTC).
      fireEvent.change(screen.getByTestId("edit-field-startDate"), {
        target: { value: "2026-06-03" },
      });
      expect(screen.getByTestId("edit-field-dayOfWeek")).toHaveValue("wednesday");
    });
  });

  // #83 — Save → Undo round-trip reopens the modal with the operator's
  // captured edits pre-applied. Plain success cycle: the save action
  // resolves; the success toast surfaces an Undo action; clicking Undo
  // sends the reverse patch; on success the modal remounts with the
  // pre-Undo edits filled in so the operator can tweak / re-save / close.
  describe("Save → Undo reopens the modal with captured edits (#83)", () => {
    beforeEach(() => {
      document.cookie = `runway_editor_name=${encodeURIComponent("Jason")}; Path=/`;
    });

    async function openEditChangeOwnerAndSave() {
      // Save flow uses the previousValues from the action response to
      // build the Undo payload; mock once-per-cycle.
      updateWeekItemFieldsAction.mockResolvedValueOnce({
        ok: true as const,
        previousValues: { owner: "Lane" },
      });
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      fireEvent.change(screen.getByTestId("edit-field-owner"), {
        target: { value: "Jill" },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("edit-save"));
        await Promise.resolve();
      });
    }

    it("Undo click reopens the modal pre-populated with the pre-Undo edits", async () => {
      await openEditChangeOwnerAndSave();
      // Save toast wired with Undo action; invoke it.
      const successCall = toastSuccess.mock.calls.at(-1) as
        | [string, { action: { onClick: () => void } }]
        | undefined;
      expect(successCall).toBeDefined();
      // Modal is closed at this point (Save closes it synchronously).
      expect(screen.queryByTestId("edit-dialog")).toBeNull();
      // Mock the Undo revert call.
      updateWeekItemFieldsAction.mockResolvedValueOnce({
        ok: true as const,
        previousValues: { owner: "Jill" },
      });
      await act(async () => {
        successCall![1].action.onClick();
        await Promise.resolve();
      });
      // Modal reopens with the captured owner value pre-applied.
      expect(screen.getByTestId("edit-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("edit-field-owner")).toHaveValue("Jill");
      // Save stays enabled because state still diffs against the (now-reverted)
      // row: state.owner="Jill" vs initial.owner="Lane".
      expect(screen.getByTestId("edit-save")).not.toBeDisabled();
    });

    it("Undo failure leaves the modal closed (DB still holds the saved value)", async () => {
      await openEditChangeOwnerAndSave();
      const successCall = toastSuccess.mock.calls.at(-1) as
        | [string, { action: { onClick: () => void } }]
        | undefined;
      updateWeekItemFieldsAction.mockResolvedValueOnce({
        ok: false,
        error: "revert blocked",
      } as never);
      await act(async () => {
        successCall![1].action.onClick();
        await Promise.resolve();
      });
      // Modal stays closed; toast surfaces the failure.
      expect(screen.queryByTestId("edit-dialog")).toBeNull();
      expect(toastError).toHaveBeenCalledWith(
        "Could not undo: revert blocked",
        expect.objectContaining({ id: expect.stringContaining("save-") }),
      );
    });

    it("subsequent fresh pencil click clears the restored state (no leak from prior Undo)", async () => {
      await openEditChangeOwnerAndSave();
      const successCall = toastSuccess.mock.calls.at(-1) as
        | [string, { action: { onClick: () => void } }]
        | undefined;
      updateWeekItemFieldsAction.mockResolvedValueOnce({
        ok: true as const,
        previousValues: { owner: "Jill" },
      });
      await act(async () => {
        successCall![1].action.onClick();
        await Promise.resolve();
      });
      // Modal is open with the Undo-restored state. Close it via Cancel,
      // then click the pencil again — should reopen with the pristine row
      // values, not the prior session's edits.
      fireEvent.click(screen.getByTestId("edit-cancel"));
      expect(screen.queryByTestId("edit-dialog")).toBeNull();
      fireEvent.click(screen.getByTestId("edit-pencil"));
      expect(screen.getByTestId("edit-field-owner")).toHaveValue("Lane");
      // Pristine — Save disabled until a fresh field is dirty.
      expect(screen.getByTestId("edit-save")).toBeDisabled();
    });
  });
});
