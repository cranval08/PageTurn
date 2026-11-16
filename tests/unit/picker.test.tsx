import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/google/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/google/config")>()),
  GOOGLE_API_KEY: "test-key",
  GOOGLE_APP_ID: "123456789012",
}));

import { ImportPanel, type ImportItem } from "../../src/components/ImportPanel";
import { buildPdfPicker, toPickedFiles } from "../../src/lib/google/picker";

interface Built {
  appId?: string;
  token?: string;
  key?: string;
  features: string[];
  views: Record<string, unknown>[];
  callback?: (d: google.picker.ResponseObject) => void;
}

let built: Built;

beforeEach(() => {
  built = { features: [], views: [] };
  class DocsView {
    o: Record<string, unknown>;
    constructor(id: string) {
      this.o = { id };
    }
    setMimeTypes(m: string) {
      this.o.mime = m;
      return this;
    }
    setOwnedByMe(v: boolean) {
      this.o.ownedByMe = v;
      return this;
    }
    setLabel(l: string) {
      this.o.label = l;
      return this;
    }
  }
  class PickerBuilder {
    setAppId(a: string) {
      built.appId = a;
      return this;
    }
    setOAuthToken(t: string) {
      built.token = t;
      return this;
    }
    setDeveloperKey(k: string) {
      built.key = k;
      return this;
    }
    enableFeature(f: string) {
      built.features.push(f);
      return this;
    }
    setTitle() {
      return this;
    }
    addView(v: DocsView) {
      built.views.push(v.o);
      return this;
    }
    setCallback(cb: Built["callback"]) {
      built.callback = cb;
      return this;
    }
    build() {
      return { setVisible() {}, dispose() {} };
    }
  }
  (globalThis as unknown as { google: unknown }).google = {
    picker: {
      DocsView,
      PickerBuilder,
      ViewId: { DOCS: "all" },
      Feature: { MULTISELECT_ENABLED: "multiselectEnabled" },
      Action: { PICKED: "picked", CANCEL: "cancel", LOADED: "loaded" },
    },
  };
});

describe("Google Picker (DRV-2)", () => {
  it("shows only PDFs in Recent, My Drive and Shared with me, with multi-select", () => {
    buildPdfPicker("tok", () => {});
    expect(built).toMatchObject({ appId: "123456789012", token: "tok", key: "test-key", features: ["multiselectEnabled"] });
    expect(built.views).toEqual([
      { id: "all", mime: "application/pdf", label: "Recent" },
      { id: "all", mime: "application/pdf", ownedByMe: true, label: "My Drive" },
      { id: "all", mime: "application/pdf", ownedByMe: false, label: "Shared with me" },
    ]);
  });

  it("returns picked files, [] on cancel, and ignores 'loaded'", () => {
    const done = vi.fn();
    buildPdfPicker("tok", done);
    built.callback!({ action: "loaded" });
    expect(done).not.toHaveBeenCalled();
    built.callback!({
      action: "picked",
      docs: [
        { id: "1", name: "a.pdf", mimeType: "application/pdf", sizeBytes: "2048" },
        { id: "2", name: "b.pdf", mimeType: "application/pdf" },
      ],
    });
    expect(done).toHaveBeenCalledWith([
      { id: "1", name: "a.pdf", mimeType: "application/pdf", sizeBytes: 2048 },
      { id: "2", name: "b.pdf", mimeType: "application/pdf", sizeBytes: undefined },
    ]);
    expect(toPickedFiles({ action: "cancel" })).toEqual([]);
  });
});

const item = (over: Partial<ImportItem>): ImportItem => ({
  key: "k",
  file: { id: "1", name: "Lecture.pdf", mimeType: "application/pdf" },
  status: "downloading",
  loaded: 0,
  total: 0,
  ...over,
});

describe("ImportPanel (DRV-3, DRV-7)", () => {
  it("shows a progress bar only for files over 5 MB", () => {
    const { rerender } = render(
      <ImportPanel items={[item({ loaded: 1_000_000, total: 4 * 1024 * 1024 })]} onRetry={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    rerender(<ImportPanel items={[item({ loaded: 3 * 1024 * 1024, total: 12 * 1024 * 1024 })]} onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("progressbar", { name: "Downloading Lecture.pdf" })).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Downloading… 3.0 MB of 12 MB")).toBeInTheDocument();
  });

  it("shows errors with Retry, and Sign in & retry for expired sessions", async () => {
    const onRetry = vi.fn();
    render(
      <ImportPanel
        items={[
          item({ key: "a", status: "error", error: "This PDF is password-protected." }),
          item({ key: "b", status: "error", error: "Session expired", authError: true, file: { id: "2", name: "B.pdf", mimeType: "application/pdf" } }),
        ]}
        onRetry={onRetry}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Added 0 of 2 books")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("password-protected");
    await userEvent.click(screen.getByRole("button", { name: "Sign in & retry" }));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ key: "b" }));
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
