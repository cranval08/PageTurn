import { describe, expect, it } from "vitest";
import { currentEntry } from "../../src/components/OutlinePanel";
import { isNewerDriveVersion } from "../../src/lib/driveUpdates";
import { destToPageIndex, loadOutline, safeExternalUrl, type NavDoc } from "../../src/lib/pdf/navigation";

const ref = (num: number) => ({ num, gen: 0 });

/** Fake pdf.js document: page refs num 100+i map to page index i. */
function fakeDoc(outline: unknown[] | null = null): NavDoc {
  return {
    getDestination: async (name: string) => (name === "chapter2" ? [ref(105), { name: "Fit" }] : null),
    getPageIndex: async (r: { num: number }) => {
      if (r.num < 100) throw new Error("bad ref");
      return r.num - 100;
    },
    getOutline: async () => outline,
    getPage: async () => {
      throw new Error("unused");
    },
  } as unknown as NavDoc;
}

describe("destToPageIndex (RDR-10, RDR-12)", () => {
  it("resolves explicit, named and numeric destinations", async () => {
    const doc = fakeDoc();
    expect(await destToPageIndex(doc, [ref(111), { name: "Fit" }])).toBe(11);
    expect(await destToPageIndex(doc, "chapter2")).toBe(5);
    expect(await destToPageIndex(doc, [3, { name: "XYZ" }, 0, 0, null])).toBe(3);
  });

  it("returns null for anything it can't resolve", async () => {
    const doc = fakeDoc();
    expect(await destToPageIndex(doc, "missing")).toBeNull();
    expect(await destToPageIndex(doc, [])).toBeNull();
    expect(await destToPageIndex(doc, [ref(1)])).toBeNull(); // getPageIndex throws
    expect(await destToPageIndex(doc, 42)).toBeNull();
  });
});

describe("safeExternalUrl (RDR-12)", () => {
  it("allows http, https and mailto only", () => {
    expect(safeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(safeExternalUrl("mailto:prof@uni.edu")).toBe("mailto:prof@uni.edu");
  });

  it("blocks script and local schemes", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "not a url", "", null, 7]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
  });
});

describe("loadOutline (RDR-10)", () => {
  const raw = [
    { title: "Chapter 1", dest: [ref(100)], items: [] },
    {
      title: "Chapter 2",
      dest: "chapter2",
      items: [
        { title: "2.1", dest: [ref(107)], items: [] },
        { title: "  ", dest: [ref(109)], items: [] },
      ],
    },
    { title: "Course site", dest: null, url: "https://example.com/", items: [] },
    { title: "Evil", dest: null, url: "javascript:alert(1)", items: [] },
  ];

  it("resolves page numbers through nested entries and keeps safe web links", async () => {
    const nodes = await loadOutline(fakeDoc(raw));
    expect(nodes.map((n) => [n.title, n.pageIndex, n.url])).toEqual([
      ["Chapter 1", 0, null],
      ["Chapter 2", 5, null],
      ["Course site", null, "https://example.com/"],
      ["Evil", null, null],
    ]);
    expect(nodes[1].children.map((n) => [n.title, n.pageIndex])).toEqual([
      ["2.1", 7],
      ["Untitled section", 9],
    ]);
  });

  it("returns [] when the PDF has no outline", async () => {
    expect(await loadOutline(fakeDoc(null))).toEqual([]);
  });

  it("highlights the section containing the current page", async () => {
    const nodes = await loadOutline(fakeDoc(raw));
    expect(currentEntry(nodes, 0)?.title).toBe("Chapter 1");
    expect(currentEntry(nodes, 6)?.title).toBe("Chapter 2");
    expect(currentEntry(nodes, 8)?.title).toBe("2.1");
    expect(currentEntry(nodes, 40)?.title).toBe("Untitled section");
  });
});

describe("isNewerDriveVersion (DRV-6)", () => {
  it("is true only when Drive's modifiedTime is later", () => {
    expect(isNewerDriveVersion("2026-11-10T09:00:00.000Z", "2026-11-12T08:00:00.000Z")).toBe(true);
    expect(isNewerDriveVersion("2026-11-10T09:00:00.000Z", "2026-11-10T09:00:00.000Z")).toBe(false);
    expect(isNewerDriveVersion("2026-11-12T09:00:00.000Z", "2026-11-10T09:00:00.000Z")).toBe(false);
  });

  it("is false when either time is missing or invalid", () => {
    expect(isNewerDriveVersion(undefined, "2026-11-12T08:00:00.000Z")).toBe(false);
    expect(isNewerDriveVersion("2026-11-10T09:00:00.000Z", undefined)).toBe(false);
    expect(isNewerDriveVersion("garbage", "2026-11-12T08:00:00.000Z")).toBe(false);
  });
});
