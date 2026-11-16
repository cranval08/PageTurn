import { describe, expect, it } from "vitest";
import { chooseLayout, chromeInset, fitPageSize, pageAnnouncement, pageLabel, spreadLeftIndex, stageMargin } from "../../src/lib/layout";

describe("chooseLayout (RDR-2)", () => {
  it("uses a spread on landscape viewports at least 900 px wide", () => {
    expect(chooseLayout("auto", 900, 600)).toBe("spread");
    expect(chooseLayout("auto", 1440, 900)).toBe("spread");
  });

  it("uses a single page below 900 px", () => {
    expect(chooseLayout("auto", 899, 600)).toBe("single");
  });

  it("uses a single page in portrait even when wide", () => {
    expect(chooseLayout("auto", 1024, 1366)).toBe("single");
    expect(chooseLayout("auto", 1000, 1000)).toBe("single");
  });

  it("respects a manual override", () => {
    expect(chooseLayout("single", 1440, 900)).toBe("single");
    expect(chooseLayout("spread", 400, 800)).toBe("spread");
  });
});

describe("fitPageSize", () => {
  const letter = 612 / 792;

  it("fits a single page by height on a wide stage", () => {
    const s = fitPageSize("single", 1000, 800, letter, 16);
    expect(s.height).toBe(768);
    expect(s.width).toBe(Math.floor(768 * letter));
  });

  it("fits a single page by width on a narrow phone stage", () => {
    const s = fitPageSize("single", 400, 800, letter, 0);
    expect(s.width).toBe(400);
    expect(s.height).toBe(Math.floor(400 / letter));
  });

  it("gives each page of a spread at most half the width", () => {
    const s = fitPageSize("spread", 1000, 2000, letter, 16);
    expect(s.width).toBe(484);
  });

  it("never returns zero sizes", () => {
    const s = fitPageSize("single", 0, 0, letter, 16);
    expect(s.width).toBeGreaterThan(0);
    expect(s.height).toBeGreaterThan(0);
  });
});

describe("chromeInset", () => {
  it("keeps the book clear of the toolbars on larger screens, full-bleed on phones", () => {
    expect(chromeInset(412)).toBe(0);
    expect(chromeInset(1280)).toBe(60);
  });
});

describe("stageMargin", () => {
  it("is 0 on phones and 16 px elsewhere", () => {
    expect(stageMargin(390)).toBe(0);
    expect(stageMargin(1280)).toBe(16);
  });
});

describe("page labels", () => {
  it("maps any index to the left page of its spread (cover alone)", () => {
    expect(spreadLeftIndex(0)).toBe(0);
    expect(spreadLeftIndex(1)).toBe(1);
    expect(spreadLeftIndex(2)).toBe(1);
    expect(spreadLeftIndex(5)).toBe(5);
    expect(spreadLeftIndex(6)).toBe(5);
  });

  it("labels spreads and single pages", () => {
    expect(pageLabel(0, 50, "spread")).toBe("1 / 50");
    expect(pageLabel(11, 312, "spread")).toBe("12–13 / 312");
    expect(pageLabel(12, 312, "spread")).toBe("12–13 / 312");
    expect(pageLabel(49, 50, "spread")).toBe("50 / 50");
    expect(pageLabel(11, 312, "single")).toBe("12 / 312");
  });

  it("announces pages for screen readers", () => {
    expect(pageAnnouncement(11, 300, "single")).toBe("Page 12 of 300");
    expect(pageAnnouncement(11, 300, "spread")).toBe("Pages 12 and 13 of 300");
  });
});
