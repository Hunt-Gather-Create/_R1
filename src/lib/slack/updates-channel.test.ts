import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPostMessage = vi.hoisted(() => vi.fn().mockResolvedValue({ ts: "ts123" }));

vi.mock("./client", () => ({
  getSlackClient: () => ({ chat: { postMessage: mockPostMessage } }),
  getUpdatesChannelId: () => "C123",
}));

import { formatTimestamp, safePostUpdate, postMutationUpdate, postFormattedMessage } from "./updates-channel";

describe("formatTimestamp", () => {
  // Every instant below is given as explicit UTC, refs _R1#119, _R1#126,
  // and _R1#128. formatTimestamp now formats in America/Chicago on
  // purpose, refs _R1#128, so a fixture built with the unsuffixed local
  // constructor only passed on a machine whose own timezone happened to
  // be Central, and failed under TZ=UTC, as CI runs, the exact bug class
  // this ticket exists to remove. Each UTC instant and its Chicago
  // equivalent below were confirmed with Intl.DateTimeFormat against
  // America/Chicago, not assumed from the UTC offset.
  it("formats a morning time correctly", () => {
    const date = new Date("2026-04-05T15:14:00Z"); // 10:14 AM CDT
    expect(formatTimestamp(date)).toBe("Apr. 5 2026 at 10:14 AM");
  });

  it("formats a PM time correctly", () => {
    const date = new Date("2026-04-05T20:05:00Z"); // 3:05 PM CDT
    expect(formatTimestamp(date)).toBe("Apr. 5 2026 at 3:05 PM");
  });

  it("formats midnight as 12:00 AM", () => {
    const date = new Date("2026-01-01T06:00:00Z"); // 12:00 AM CST
    expect(formatTimestamp(date)).toBe("Jan. 1 2026 at 12:00 AM");
  });

  it("formats noon as 12:00 PM", () => {
    const date = new Date("2026-01-01T18:00:00Z"); // 12:00 PM CST
    expect(formatTimestamp(date)).toBe("Jan. 1 2026 at 12:00 PM");
  });

  it("uses May without a period", () => {
    const date = new Date("2026-05-11T14:30:00Z"); // 9:30 AM CDT
    expect(formatTimestamp(date)).toBe("May 11 2026 at 9:30 AM");
  });

  it("pads minutes to two digits", () => {
    const date = new Date("2026-06-15T13:03:00Z"); // 8:03 AM CDT
    expect(formatTimestamp(date)).toBe("Jun. 15 2026 at 8:03 AM");
  });

  it("formats December correctly", () => {
    const date = new Date("2026-12-26T05:59:00Z"); // 11:59 PM CST, Dec 25
    expect(formatTimestamp(date)).toBe("Dec. 25 2026 at 11:59 PM");
  });
});

describe("safePostUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls postUpdate successfully", async () => {
    mockPostMessage.mockResolvedValueOnce({ ts: "ts123" });

    await safePostUpdate({
      clientName: "Convergix",
      updateText: "Status changed",
      updatedBy: "Kathy",
    });

    expect(mockPostMessage).toHaveBeenCalledOnce();
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C123" })
    );
  });

  it("does not throw when Slack fails", async () => {
    mockPostMessage.mockRejectedValueOnce(new Error("Slack down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      safePostUpdate({ clientName: "Test", updateText: "test", updatedBy: "bot" })
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("runway_update_post_error")
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Slack down")
    );

    consoleSpy.mockRestore();
  });
});

describe("postMutationUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts when result.ok is true, using clientName from result.data", async () => {
    await postMutationUpdate({
      result: { ok: true, message: "Done", data: { clientName: "Convergix" } },
      fallbackClientName: "convergix",
      updateText: "Status updated",
      updatedBy: "Kathy",
    });

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const text = mockPostMessage.mock.calls[0][0].text as string;
    expect(text).toContain("*Convergix*");
    expect(text).toContain("Status updated");
  });

  it("falls back to fallbackClientName when result.data has no clientName", async () => {
    await postMutationUpdate({
      result: { ok: true, message: "Done", data: {} },
      fallbackClientName: "convergix",
      updateText: "Deleted",
      updatedBy: "mcp",
    });

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const text = mockPostMessage.mock.calls[0][0].text as string;
    expect(text).toContain("*convergix*");
  });

  it("falls back to fallbackClientName when result.data is undefined", async () => {
    await postMutationUpdate({
      result: { ok: true, message: "Done" },
      fallbackClientName: "Calendar",
      updateText: "Removed item",
      updatedBy: "mcp",
    });

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const text = mockPostMessage.mock.calls[0][0].text as string;
    expect(text).toContain("*Calendar*");
  });

  it("does not post when result.ok is false", async () => {
    await postMutationUpdate({
      result: { ok: false, error: "Not found" },
      fallbackClientName: "convergix",
      updateText: "Should not appear",
      updatedBy: "mcp",
    });

    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("passes projectName through to the Slack message", async () => {
    await postMutationUpdate({
      result: { ok: true, message: "Done", data: { clientName: "Bonterra" } },
      fallbackClientName: "bonterra",
      projectName: "Impact Report",
      updateText: "dueDate updated",
      updatedBy: "Jill",
    });

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const text = mockPostMessage.mock.calls[0][0].text as string;
    expect(text).toContain("*Bonterra*");
    expect(text).toContain("_Project:_ Impact Report");
    expect(text).toContain("dueDate updated");
  });

  it("omits projectName line when not provided", async () => {
    await postMutationUpdate({
      result: { ok: true, message: "Done", data: { clientName: "Team" } },
      fallbackClientName: "Team",
      updateText: "New member: Lane",
      updatedBy: "Kathy",
    });

    const text = mockPostMessage.mock.calls[0][0].text as string;
    expect(text).not.toContain("_Project:_");
  });
});

describe("postFormattedMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts raw text to the updates channel", async () => {
    mockPostMessage.mockResolvedValueOnce({ ts: "ts456" });

    const ts = await postFormattedMessage("*Convergix*\n- Updated owner");

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: "C123",
      text: "*Convergix*\n- Updated owner",
      unfurl_links: false,
      unfurl_media: false,
    });
    expect(ts).toBe("ts456");
  });
});
