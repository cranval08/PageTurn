import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_HIDE_MS, useAutoHide } from "../../src/app/useAutoHide";
import { GoToPage, parsePageInput } from "../../src/components/GoToPage";
import { Toolbar } from "../../src/components/Toolbar";

function Harness({ onGoTo = vi.fn() }: { onGoTo?: (p: number) => void }) {
  const [pinned, setPinned] = useState(false);
  const chrome = useAutoHide(pinned);
  return (
    <MemoryRouter>
      <button type="button" onClick={chrome.toggle}>
        centre tap
      </button>
      <Toolbar
        visible={chrome.visible}
        title="Organic Chemistry"
        indicator="12–13 / 312"
        pageCount={312}
        currentPage={12}
        zoomPercent={100}
        canZoomIn
        canZoomOut={false}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onGoTo={onGoTo}
        onOpenSettings={vi.fn()}
        fullscreen={{ supported: true, active: false, toggle: vi.fn() }}
        onActivity={chrome.show}
        onPinnedChange={setPinned}
      />
    </MemoryRouter>
  );
}

const topBar = () => screen.getByTestId("top-bar");

describe("Toolbar auto-hide (RDR-7)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts visible, hides after 3 s, and a centre tap shows it again", () => {
    render(<Harness />);
    expect(topBar()).toHaveAttribute("data-visible", "true");
    act(() => vi.advanceTimersByTime(AUTO_HIDE_MS - 1));
    expect(topBar()).toHaveAttribute("data-visible", "true");
    act(() => vi.advanceTimersByTime(1));
    expect(topBar()).toHaveAttribute("data-visible", "false");
    expect(topBar()).toHaveClass("opacity-0");

    fireEvent.click(screen.getByText("centre tap"));
    expect(topBar()).toHaveAttribute("data-visible", "true");
    act(() => vi.advanceTimersByTime(AUTO_HIDE_MS));
    expect(topBar()).toHaveAttribute("data-visible", "false");
  });

  it("shows again when a control gets keyboard focus", () => {
    render(<Harness />);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_MS));
    expect(topBar()).toHaveAttribute("data-visible", "false");
    act(() => screen.getByRole("button", { name: "Reading settings" }).focus());
    expect(topBar()).toHaveAttribute("data-visible", "true");
  });

  it("stays visible while Go to page is open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("page-indicator"));
    act(() => vi.advanceTimersByTime(AUTO_HIDE_MS * 3));
    expect(topBar()).toHaveAttribute("data-visible", "true");
  });

  it("labels every icon button", () => {
    render(<Harness />);
    for (const name of ["Back to library", "Reading settings", "Full screen", "Zoom in", "Zoom out"]) {
      expect(screen.getByRole(name === "Back to library" ? "link" : "button", { name })).toBeInTheDocument();
    }
  });
});

describe("Go to page (RDR-9)", () => {
  it("validates the page number", () => {
    expect(parsePageInput("40", 312)).toEqual({ page: 40 });
    expect(parsePageInput(" 312 ", 312)).toEqual({ page: 312 });
    for (const bad of ["0", "313", "", "4.5", "abc", "-1"]) {
      expect(parsePageInput(bad, 312)).toEqual({ error: "Enter a page from 1 to 312." });
    }
  });

  it("opens from the page indicator, jumps on Enter, and explains bad input", async () => {
    const onGoTo = vi.fn();
    render(<Harness onGoTo={onGoTo} />);
    await userEvent.click(screen.getByRole("button", { name: /Go to page/ }));
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveFocus();
    expect(input).toHaveValue(12);

    await userEvent.clear(input);
    await userEvent.type(input, "999{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a page from 1 to 312.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onGoTo).not.toHaveBeenCalled();

    await userEvent.clear(input);
    await userEvent.type(input, "40{Enter}");
    expect(onGoTo).toHaveBeenCalledWith(40);
    expect(screen.queryByRole("form", { name: "Go to page" })).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<GoToPage pageCount={50} currentPage={1} onGo={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
