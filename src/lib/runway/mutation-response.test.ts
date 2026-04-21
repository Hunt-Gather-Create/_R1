/**
 * Mostly compile-time tests — verifies that a `MutationResponse` value is
 * assignable to the legacy `OperationResult` shape used by callers like
 * `updates-channel.ts` and `bot-tools.ts`. Runtime asserts the shape builds.
 */
import { describe, it, expect } from "vitest";
import type { OperationResult } from "./operations-utils";
import type {
  CascadedItemInfo,
  ReverseCascadeInfo,
  MutationResponse,
  MutationSuccess,
  UpdateProjectStatusData,
  UpdateProjectFieldData,
  UpdateWeekItemFieldData,
} from "./mutation-response";

describe("MutationResponse", () => {
  it("success variant is assignable to legacy OperationResult", () => {
    const data: UpdateProjectStatusData = {
      clientName: "Convergix",
      projectName: "CDS Messaging",
      previousStatus: "in-production",
      newStatus: "completed",
      cascadedItems: ["CDS Review"],
      cascadeDetail: [
        {
          itemId: "wi1",
          itemTitle: "CDS Review",
          field: "status",
          previousValue: null,
          newValue: "completed",
          auditId: "aud-1",
        },
      ],
      auditId: "aud-parent",
    };
    const ok: MutationSuccess<UpdateProjectStatusData> = {
      ok: true,
      message: "Updated.",
      data,
    };
    const legacy: OperationResult = ok;
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      // Existing back-compat fields
      expect(legacy.data?.cascadedItems).toEqual(["CDS Review"]);
      // New structured field (typed via cast — OperationResult's data is loose)
      const detail = legacy.data?.cascadeDetail as CascadedItemInfo[];
      expect(detail[0].itemId).toBe("wi1");
      expect(detail[0].auditId).toBe("aud-1");
    }
  });

  it("failure variant preserves error + available", () => {
    const fail: MutationResponse = {
      ok: false,
      error: "nope",
      available: ["a", "b"],
    };
    const legacy: OperationResult = fail;
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) {
      expect(legacy.error).toBe("nope");
      expect(legacy.available).toEqual(["a", "b"]);
    }
  });

  it("UpdateProjectFieldData carries cascade + audit metadata", () => {
    const data: UpdateProjectFieldData = {
      clientName: "Convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      previousValue: "2026-04-15",
      newValue: "2026-04-28",
      cascadedItems: ["Code handoff"],
      cascadeDetail: [
        {
          itemId: "wi2",
          itemTitle: "Code handoff",
          field: "date",
          previousValue: "2026-04-15",
          newValue: "2026-04-28",
          auditId: "aud-child",
        },
      ],
      auditId: "aud-parent",
    };
    expect(data.cascadedItems[0]).toBe(data.cascadeDetail[0].itemTitle);
  });

  it("UpdateWeekItemFieldData carries reverseCascadeDetail", () => {
    const rc: ReverseCascadeInfo = {
      projectId: "p1",
      projectName: "CDS Messaging",
      field: "dueDate",
      previousDueDate: "2026-04-15",
      newDueDate: "2026-04-28",
      auditId: "aud-reverse",
    };
    const data: UpdateWeekItemFieldData = {
      weekItemTitle: "CDS Deadline",
      field: "date",
      previousValue: "2026-04-15",
      newValue: "2026-04-28",
      clientName: "Convergix",
      reverseCascaded: true,
      reverseCascadeDetail: rc,
      auditId: "aud-week",
    };
    expect(data.reverseCascaded).toBe(true);
    expect(data.reverseCascadeDetail?.projectId).toBe("p1");
  });

  it("reverseCascadeDetail is null when no cascade fired", () => {
    const data: UpdateWeekItemFieldData = {
      weekItemTitle: "CDS Review",
      field: "status",
      previousValue: "",
      newValue: "completed",
      reverseCascaded: false,
      reverseCascadeDetail: null,
    };
    expect(data.reverseCascaded).toBe(false);
    expect(data.reverseCascadeDetail).toBeNull();
  });
});
