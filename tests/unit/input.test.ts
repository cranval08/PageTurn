import { describe, expect, it } from "vitest";
import { isTap, keyToAction, tapZone } from "../../src/lib/input";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe("keyToAction (RDR-3)", () => {
  it.each([
    ["ArrowRight", "next"],
    ["PageDown", "next"],
    [" ", "next"],
    ["ArrowLeft", "prev"],
    ["PageUp", "prev"],
  ])("%j turns %s", (k, action) => {
    expect(keyToAction(key(k))).toBe(action);
  });

  it("Shift+Space goes back", () => {
    expect(keyToAction(key(" ", { shiftKey: true }))).toBe("prev");
  });

  it("ignores other keys and modifier shortcuts", () => {
    expect(keyToAction(key("a"))).toBeNull();
    expect(keyToAction(key("ArrowRight", { altKey: true }))).toBeNull();
    expect(keyToAction(key("ArrowLeft", { metaKey: true }))).toBeNull();
  });
});

describe("tapZone (RDR-3)", () => {
  it("maps the left 20% to previous, right 20% to next, centre to chrome", () => {
    expect(tapZone(0, 1000)).toBe("prev");
    expect(tapZone(199, 1000)).toBe("prev");
    expect(tapZone(200, 1000)).toBe("center");
    expect(tapZone(500, 1000)).toBe("center");
    expect(tapZone(800, 1000)).toBe("center");
    expect(tapZone(801, 1000)).toBe("next");
  });
});

describe("isTap", () => {
  it("accepts short, still presses and rejects drags or long presses", () => {
    expect(isTap(3, 4, 120)).toBe(true);
    expect(isTap(30, 0, 120)).toBe(false);
    expect(isTap(0, 0, 900)).toBe(false);
  });
});
