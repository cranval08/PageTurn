import { GAPI_SCRIPT_URL, GOOGLE_API_KEY, GOOGLE_APP_ID } from "./config";
import { loadScript } from "./scripts";

export const PDF_MIME = "application/pdf";

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

let pickerLoaded: Promise<void> | null = null;

/** Load gapi + the Picker module on demand (bundle-size NFR). */
export function loadPicker(): Promise<void> {
  pickerLoaded ??= loadScript(GAPI_SCRIPT_URL)
    .then(
      () =>
        new Promise<void>((resolve, reject) =>
          gapi.load("picker", {
            callback: resolve,
            onerror: () => reject(new Error("Couldn't load the Google Picker.")),
            timeout: 15_000,
            ontimeout: () => reject(new Error("The Google Picker took too long to load. Check your connection.")),
          }),
        ),
    )
    .catch((err) => {
      pickerLoaded = null;
      throw err;
    });
  return pickerLoaded;
}

export function toPickedFiles(data: google.picker.ResponseObject): PickedFile[] | null {
  if (data.action === google.picker.Action.CANCEL) return [];
  if (data.action !== google.picker.Action.PICKED) return null; // e.g. "loaded": keep waiting
  return (data.docs ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes === undefined ? undefined : Number(d.sizeBytes),
  }));
}

/**
 * DRV-2: Picker filtered to PDFs, with Recent, My Drive and Shared with me views,
 * multi-select on. setAppId (project number) is required for drive.file access.
 */
export function buildPdfPicker(token: string, onDone: (files: PickedFile[]) => void): google.picker.Picker {
  const { DocsView, ViewId, PickerBuilder, Feature } = google.picker;
  const recent = new DocsView(ViewId.DOCS).setMimeTypes(PDF_MIME).setLabel("Recent");
  const myDrive = new DocsView(ViewId.DOCS).setMimeTypes(PDF_MIME).setOwnedByMe(true).setLabel("My Drive");
  const shared = new DocsView(ViewId.DOCS).setMimeTypes(PDF_MIME).setOwnedByMe(false).setLabel("Shared with me");
  return new PickerBuilder()
    .setAppId(GOOGLE_APP_ID)
    .setOAuthToken(token)
    .setDeveloperKey(GOOGLE_API_KEY)
    .enableFeature(Feature.MULTISELECT_ENABLED)
    .setTitle("Choose PDFs to read")
    .addView(recent)
    .addView(myDrive)
    .addView(shared)
    .setCallback((data) => {
      const files = toPickedFiles(data);
      if (files) onDone(files);
    })
    .build();
}

/** Show the Picker; resolves with the chosen files ([] if cancelled). */
export async function pickPdfs(token: string): Promise<PickedFile[]> {
  await loadPicker();
  return new Promise((resolve) => {
    const picker = buildPdfPicker(token, (files) => {
      picker.dispose();
      resolve(files);
    });
    picker.setVisible(true);
  });
}
