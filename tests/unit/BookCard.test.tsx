import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BookCard } from "../../src/components/BookCard";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import type { Book } from "../../src/lib/db/schema";

const book: Book = {
  id: "local:abc",
  source: "local",
  title: "Organic Chemistry",
  pageCount: 312,
  sizeBytes: 1000,
  coverDataUrl: "data:image/jpeg;base64,AAAA",
  addedAt: 1,
  lastOpenedAt: 2,
};

describe("BookCard (LIB-1)", () => {
  it("shows title, source and progress", () => {
    render(<BookCard book={book} page={84} cached onOpen={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Organic Chemistry" })).toBeInTheDocument();
    expect(screen.getByText("From this device")).toBeInTheDocument();
    expect(screen.getByTestId("book-progress")).toHaveTextContent("p. 84 of 312 · 27%");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "27");
  });

  it("labels Drive books", () => {
    render(<BookCard book={{ ...book, source: "drive" }} cached onOpen={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("From Google Drive")).toBeInTheDocument();
  });

  it("marks books whose file is not on this device", () => {
    render(<BookCard book={book} cached={false} onOpen={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Not on this device")).toBeInTheDocument();
  });

  it("opens on click and offers Remove in the ⋮ menu (LIB-3)", async () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(<BookCard book={book} cached onOpen={onOpen} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: /^Open Organic Chemistry/ }));
    expect(onOpen).toHaveBeenCalledWith(book);

    await userEvent.click(screen.getByRole("button", { name: "More actions for Organic Chemistry" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from library" }));
    expect(onRemove).toHaveBeenCalledWith(book);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the menu on Escape", async () => {
    render(<BookCard book={book} cached onOpen={vi.fn()} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /More actions/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog (LIB-3)", () => {
  it("focuses Cancel, and confirms or cancels", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Remove?" message="Sure?" confirmLabel="Remove" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole("alertdialog", { name: "Remove?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
