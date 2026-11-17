import { describe, expect, it } from "vitest";
import { formatBytes, progressLabel, progressPercent, timeAgo } from "../../src/lib/format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [113884, "111 KB"],
    [1536 * 1024, "1.5 MB"],
    [30 * 1024 * 1024, "30 MB"],
    [2.5 * 1024 ** 3, "2.5 GB"],
  ])("%d → %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("progress (LIB-1)", () => {
  it('formats "p. 84 of 312 · 27%"', () => {
    expect(progressLabel(84, 312)).toBe("p. 84 of 312 · 27%");
  });

  it("handles unread books and bounds", () => {
    expect(progressLabel(undefined, 50)).toBe("Not started · 50 pages");
    expect(progressLabel(undefined, 1)).toBe("Not started · 1 page");
    expect(progressPercent(50, 50)).toBe(100);
    expect(progressPercent(5, 0)).toBe(0);
  });
});

describe("PRG-2: last synced label", () => {
  const now = 10_000_000_000;
  it.each([
    [0, "just now"],
    [59_000, "just now"],
    [60_000, "1 minute ago"],
    [5 * 60_000, "5 minutes ago"],
    [60 * 60_000, "1 hour ago"],
    [23 * 3_600_000, "23 hours ago"],
    [49 * 3_600_000, "2 days ago"],
    [-5_000, "just now"],
  ])("%d ms ago → %s", (ago, text) => {
    expect(timeAgo(now - ago, now)).toBe(text);
  });
});
