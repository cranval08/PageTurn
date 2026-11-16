import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_DEBOUNCE_MS } from "../../src/app/ReaderPage";
import { debounce } from "../../src/lib/debounce";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("progress debounce (PRG-1)", () => {
  it("uses the 500 ms window from the PRD", () => {
    expect(SAVE_DEBOUNCE_MS).toBe(500);
  });

  it("saves once, with the last page, 500 ms after the last turn", () => {
    const save = vi.fn();
    const d = debounce(save, 500);
    d.call(2);
    vi.advanceTimersByTime(300);
    d.call(3);
    vi.advanceTimersByTime(300);
    d.call(4);
    vi.advanceTimersByTime(499);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(4);
  });

  it("flush saves the pending page immediately, once", () => {
    const save = vi.fn();
    const d = debounce(save, 500);
    d.call(9);
    d.flush();
    expect(save).toHaveBeenCalledWith(9);
    vi.advanceTimersByTime(1000);
    d.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cancel drops the pending save", () => {
    const save = vi.fn();
    const d = debounce(save, 500);
    d.call(1);
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });
});
