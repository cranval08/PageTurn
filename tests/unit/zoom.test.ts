import { describe, expect, it } from "vitest";
import { defaultAnimation } from "../../src/store/settings";
import { clampPan, clampScale, IDENTITY, isZoomed, zoomAt } from "../../src/lib/zoom";

const content = { width: 400, height: 500 };
const stage = { width: 400, height: 800 };

describe("zoom maths (RDR-6)", () => {
  it("keeps zoom between 100% and 400%", () => {
    expect(clampScale(0.5)).toBe(1);
    expect(clampScale(2.5)).toBe(2.5);
    expect(clampScale(9)).toBe(4);
  });

  it("zooms around the focus point so it stays under the finger", () => {
    const z = zoomAt(IDENTITY, 2, { x: 100, y: 50 });
    expect(z).toEqual({ scale: 2, x: -100, y: -50 });
    // Content point under the focus: (focus - t) / s is unchanged.
    expect((100 - z.x) / z.scale).toBe(100);
  });

  it("returns to identity at 100%", () => {
    expect(zoomAt({ scale: 3, x: 50, y: 20 }, 0.8, { x: 0, y: 0 })).toEqual(IDENTITY);
    expect(isZoomed(IDENTITY)).toBe(false);
    expect(isZoomed({ scale: 1.5, x: 0, y: 0 })).toBe(true);
  });

  it("limits panning to the zoomed overflow", () => {
    // 2x: 800x1000 content in a 400x800 stage → may move ±200 horizontally, ±100 vertically.
    expect(clampPan({ scale: 2, x: 999, y: -999 }, content, stage)).toEqual({ scale: 2, x: 200, y: -100 });
    // Content smaller than the stage on an axis stays centred on it.
    expect(clampPan({ scale: 1.2, x: 0, y: 300 }, content, stage).y).toBe(0);
  });
});

describe("animation default (RDR-4)", () => {
  it("is off when the OS asks for reduced motion, curl otherwise", () => {
    expect(defaultAnimation(true)).toBe("none");
    expect(defaultAnimation(false)).toBe("curl");
  });
});
