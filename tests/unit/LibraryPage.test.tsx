import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LibraryPage from "../../src/app/LibraryPage";
import { db } from "../../src/lib/db/schema";
import { NotPdfError } from "../../src/lib/files";

// pdf.js and canvas don't run in jsdom: stub the add pipeline.
const addLocalBook = vi.fn();
vi.mock("../../src/lib/addBook", () => ({ addLocalBook: (f: File) => addLocalBook(f) }));

function renderLibrary() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/read/:bookId" element={<p>reader opened</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  addLocalBook.mockReset();
  await db.delete();
  await db.open();
});

describe("LibraryPage", () => {
  it("LIB-4: empty state explains both ways to add a book", async () => {
    renderLibrary();
    expect(await screen.findByRole("heading", { name: /your library is empty/i })).toBeInTheDocument();
    expect(screen.getByText("From this device")).toBeInTheDocument();
    expect(screen.getByText("From Google Drive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open from this device/i })).toBeInTheDocument();
  });

  it("DRV-5: shows a clear error for a non-PDF file", async () => {
    addLocalBook.mockRejectedValue(new NotPdfError("notes.txt"));
    renderLibrary();
    await userEvent.upload(screen.getByTestId("file-input"), new File(["x"], "notes.txt"), { applyAccept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent(/not a PDF/i);
  });

  it("DRV-5: opens the reader after adding a PDF", async () => {
    addLocalBook.mockResolvedValue({ id: "local:abc" });
    renderLibrary();
    await userEvent.upload(screen.getByTestId("file-input"), new File(["%PDF-1.4"], "book.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("reader opened")).toBeInTheDocument();
  });

  it("LIB-1: lists stored books with progress", async () => {
    await db.books.bulkPut([
      { id: "local:1", source: "local", title: "Calculus", pageCount: 312, sizeBytes: 1, coverDataUrl: "data:,", addedAt: 1, lastOpenedAt: 2 },
      { id: "local:2", source: "local", title: "Physics", pageCount: 100, sizeBytes: 1, coverDataUrl: "data:,", addedAt: 1, lastOpenedAt: 1 },
    ]);
    await db.progress.put({ bookId: "local:1", page: 84, updatedAt: 2, bookmarks: [] });
    renderLibrary();
    const cards = await screen.findAllByTestId("book-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Calculus");
    expect(cards[0]).toHaveTextContent("p. 84 of 312 · 27%");
    expect(cards[1]).toHaveTextContent("Not started · 100 pages");
  });
});
