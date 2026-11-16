import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Scrubber } from "../../src/components/Scrubber";

describe("Scrubber (RDR-8)", () => {
  it("shows a live page preview while dragging and jumps on release", () => {
    const onCommit = vi.fn();
    render(<Scrubber pageCount={312} currentPage={12} onCommit={onCommit} />);
    const slider = screen.getByRole("slider", { name: "Page" });
    expect(slider).toHaveValue("12");
    expect(slider).toHaveAttribute("aria-valuetext", "Page 12 of 312");

    fireEvent.change(slider, { target: { value: "140" } });
    expect(screen.getByTestId("scrubber-preview")).toHaveTextContent("p. 140");
    expect(slider).toHaveAttribute("aria-valuetext", "Page 140 of 312");
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider);
    expect(onCommit).toHaveBeenCalledWith(140);
    expect(screen.queryByTestId("scrubber-preview")).not.toBeInTheDocument();
  });

  it("commits keyboard steps and ignores a release on the same page", () => {
    const onCommit = vi.fn();
    render(<Scrubber pageCount={50} currentPage={5} onCommit={onCommit} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "6" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledWith(6);

    onCommit.mockClear();
    fireEvent.change(slider, { target: { value: "5" } });
    fireEvent.pointerUp(slider);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("is hidden for a one-page document", () => {
    render(<Scrubber pageCount={1} currentPage={1} onCommit={vi.fn()} />);
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});
