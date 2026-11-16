import { describe, expect, it, vi } from "vitest";
import { PageCache } from "../../src/lib/pdf/pageCache";
import {
  desiredQuality,
  LOW_PIXEL_RATIO,
  MAX_CANVAS_PIXELS,
  MAX_RENDERED_PAGES,
  renderPixelRatio,
  renderWindow,
  visiblePages,
} from "../../src/lib/pdf/renderPlan";

describe("PageCache eviction (Memory NFR)", () => {
  it("keeps at most `capacity` entries, evicting the least recently used", () => {
    const evicted: number[] = [];
    const cache = new PageCache<number, string>(3, (k) => evicted.push(k));
    cache.set(1, "a");
    cache.set(2, "b");
    cache.set(3, "c");
    cache.get(1); // 1 is now most recent
    cache.set(4, "d");
    expect(evicted).toEqual([2]);
    expect(cache.keys()).toEqual([3, 1, 4]);
    expect(cache.size).toBe(3);
  });

  it("releases the old value when a page is re-rendered", () => {
    const onEvict = vi.fn();
    const cache = new PageCache<number, string>(6, onEvict);
    cache.set(5, "low");
    cache.set(5, "high");
    expect(onEvict).toHaveBeenCalledWith(5, "low");
    expect(cache.peek(5)).toBe("high");
    expect(cache.size).toBe(1);
  });

  it("peek does not change recency; clear and delete release everything", () => {
    const evicted: number[] = [];
    const cache = new PageCache<number, string>(2, (k) => evicted.push(k));
    cache.set(1, "a");
    cache.set(2, "b");
    cache.peek(1);
    cache.set(3, "c");
    expect(evicted).toEqual([1]);
    cache.delete(2);
    cache.clear();
    expect(evicted).toEqual([1, 2, 3]);
    expect(cache.size).toBe(0);
  });

  it("never holds more than 6 pages while paging through 1,000 pages", () => {
    let live = 0;
    let peak = 0;
    const cache = new PageCache<number, number>(MAX_RENDERED_PAGES, () => live--);
    for (let index = 0; index < 1000; index++) {
      for (const page of renderWindow(index, "single", 1000)) {
        if (cache.get(page) === undefined) {
          cache.set(page, page);
          live++;
          peak = Math.max(peak, live);
        }
      }
    }
    expect(peak).toBeLessThanOrEqual(6);
  });
});

describe("render window (RDR-5, Memory NFR)", () => {
  it("knows which pages are on screen", () => {
    expect(visiblePages(4, "single", 50)).toEqual([4]);
    expect(visiblePages(0, "spread", 50)).toEqual([0]); // cover alone
    expect(visiblePages(3, "spread", 50)).toEqual([3, 4]);
    expect(visiblePages(4, "spread", 50)).toEqual([3, 4]);
    expect(visiblePages(49, "spread", 50)).toEqual([49]); // last page alone
  });

  it("covers the current spread ± 2 and never more than 6 pages", () => {
    expect(renderWindow(10, "single", 1000)).toEqual([8, 9, 10, 11, 12]);
    expect(renderWindow(11, "spread", 1000)).toEqual([9, 10, 11, 12, 13, 14]);
    expect(renderWindow(0, "spread", 1000)).toEqual([0, 1, 2]);
    expect(renderWindow(999, "single", 1000)).toEqual([997, 998, 999]);
    for (let i = 0; i < 1000; i += 37) {
      expect(renderWindow(i, "spread", 1000).length).toBeLessThanOrEqual(MAX_RENDERED_PAGES);
    }
  });

  it("renders visible pages crisp only once settled, neighbours low, the rest not at all", () => {
    expect(desiredQuality(10, 10, "single", 100, true)).toBe("high");
    expect(desiredQuality(10, 10, "single", 100, false)).toBe("low");
    expect(desiredQuality(12, 10, "single", 100, true)).toBe("low");
    expect(desiredQuality(13, 10, "single", 100, true)).toBe("none");
    expect(desiredQuality(12, 11, "spread", 100, true)).toBe("high");
  });
});

describe("renderPixelRatio (RDR-5)", () => {
  it("uses a cheap low-res pass, then the device pixel ratio", () => {
    expect(renderPixelRatio("low", 3, 1, 400, 520)).toBe(LOW_PIXEL_RATIO);
    expect(renderPixelRatio("high", 2.625, 1, 400, 520)).toBe(2.625);
  });

  it("renders sharper when zoomed, but caps canvas size", () => {
    expect(renderPixelRatio("high", 2, 2, 400, 520)).toBe(4);
    const pr = renderPixelRatio("high", 3, 4, 412, 533);
    expect(412 * pr * 533 * pr).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
  });
});
