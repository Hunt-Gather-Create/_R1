import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  act,
  cleanup,
} from "@testing-library/react";

const updateWeekItemFieldsAction = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, previousValues: {} })),
);
const toastLoading = vi.hoisted(() => vi.fn(() => "toast-id"));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("../actions", () => ({
  updateWeekItemFieldsAction: (input: unknown) =>
    updateWeekItemFieldsAction(input as never),
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
    ...overrides,
  };
}

describe("EditPencil", () => {
  beforeEach(() => {
    updateWeekItemFieldsAction.mockClear();
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

    it("renders category and project as read-only inputs (cascades from project; edit defers to #11)", () => {
      render(<EditPencil item={makeItem()} />);
      fireEvent.click(screen.getByTestId("edit-pencil"));
      const cat = screen.getByTestId("edit-field-category");
      const proj = screen.getByTestId("edit-field-project");
      expect(cat).toHaveAttribute("readonly");
      expect(proj).toHaveAttribute("readonly");
      expect(cat).toHaveValue("delivery");
      expect(proj).toHaveValue("Brand Refresh");
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
});
