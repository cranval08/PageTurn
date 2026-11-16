import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import LibraryPage from "../../src/app/LibraryPage";

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

describe("LibraryPage (DRV-5)", () => {
  it("explains how to add a book", () => {
    renderLibrary();
    expect(screen.getByRole("heading", { name: /your library is empty/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open from this device/i })).toBeInTheDocument();
  });

  it("shows a clear error for a non-PDF file", async () => {
    renderLibrary();
    const input = screen.getByTestId("file-input");
    const file = new File(["just text"], "notes.txt", { type: "text/plain" });
    await userEvent.upload(input, file, { applyAccept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent(/not a PDF/i);
  });

  it("opens the reader for a PDF file", async () => {
    renderLibrary();
    const file = new File(["%PDF-1.4\n%%EOF"], "book.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByTestId("file-input"), file);
    expect(await screen.findByText("reader opened")).toBeInTheDocument();
  });
});
