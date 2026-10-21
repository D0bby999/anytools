/**
 * google-picker.client.ts
 * Opens the Google Picker and resolves with what the user picked.
 *
 * Client-only, and the `.client` suffix is what enforces it: React Router
 * replaces this module with an empty one in the server build, so nothing here
 * is evaluated during SSR — which matters, because everything here touches
 * `document` and `window`. Callers use it from event handlers only.
 *
 * The Picker script is loaded at RUNTIME, on the first click that needs it,
 * rather than as a <script> in the document: most pages never open the Picker,
 * and a third-party script on every page is a cost and an exposure paid for
 * nothing. Loading is memoised, so a second "Pick more" does not add a second
 * script tag.
 *
 * Folder selection is ON (DocsView with setSelectFolderEnabled), because the
 * server expands a picked folder to its children at pick time. Spike C
 * (reports/spike-drive.md) configured the same views.
 */
import type { PickedItem } from "~/lib/drive-types";

const GAPI_SRC = "https://apis.google.com/js/api.js";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// The slice of Google's Picker API this module uses. Declared here rather than
// pulled from @types/google.picker: four builders and a callback do not
// justify a dependency, and a type package cannot make the runtime script load.
type PickerDocument = Record<string, unknown>;
type PickerResponse = Record<string, unknown>;

type DocsView = {
  setIncludeFolders(v: boolean): DocsView;
  setSelectFolderEnabled(v: boolean): DocsView;
  setMimeTypes(v: string): DocsView;
  setFileIds(v: string): DocsView;
};

type PickerBuilder = {
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setTitle(t: string): PickerBuilder;
  addView(v: DocsView): PickerBuilder;
  enableFeature(f: unknown): PickerBuilder;
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
};

type PickerNamespace = {
  DocsView: new (viewId?: unknown) => DocsView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: unknown; FOLDERS: unknown };
  Feature: { MULTISELECT_ENABLED: unknown };
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string; DOCUMENTS: string };
  Document: { ID: string; MIME_TYPE: string };
};

type GoogleWindow = Window & {
  gapi?: { load(name: string, cb: () => void): void };
  google?: { picker?: PickerNamespace };
};

let loading: Promise<PickerNamespace> | null = null;

/** Loads api.js and the picker module once; later calls share the promise. */
export function loadPicker(): Promise<PickerNamespace> {
  if (loading) return loading;
  loading = new Promise<PickerNamespace>((resolve, reject) => {
    const w = window as GoogleWindow;
    const ready = () =>
      w.gapi!.load("picker", () => {
        const picker = w.google?.picker;
        if (picker) resolve(picker);
        else reject(new Error("the Google Picker did not load"));
      });

    if (w.gapi) {
      ready();
      return;
    }
    const script = document.createElement("script");
    script.src = GAPI_SRC;
    script.async = true;
    script.onload = ready;
    script.onerror = () => reject(new Error("the Google Picker script could not be loaded"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // A failed load is not cached: a blocked network or an extension that ate
    // the script should be retryable by clicking again, not broken until reload.
    loading = null;
    throw error;
  });
  return loading;
}

export type OpenPickerOptions = {
  apiKey: string;
  appId: string;
  accessToken: string;
  title?: string;
  /**
   * One kind of file only (learning-tool-connections phase 5): a form, a
   * sheet. With it there is no folder view and one pick at a time.
   */
  mimeTypes?: string;
  /**
   * Exactly these files (phase 6): a class's attachments, offered so the
   * learner grants drive.file on each with one confirmation.
   */
  fileIds?: string[];
};

/**
 * Shows the Picker. Resolves with the picked items, or null if the user
 * closed it without picking.
 */
export async function openDrivePicker(opts: OpenPickerOptions): Promise<PickedItem[] | null> {
  const picker = await loadPicker();

  return new Promise((resolve) => {
    const narrow = Boolean(opts.mimeTypes || opts.fileIds);
    let docs = new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(!narrow)
      .setSelectFolderEnabled(!narrow);
    if (opts.mimeTypes) docs = docs.setMimeTypes(opts.mimeTypes);
    if (opts.fileIds) docs = docs.setFileIds(opts.fileIds.join(","));

    let builder = new picker.PickerBuilder()
      .setDeveloperKey(opts.apiKey)
      // The project NUMBER. Under drive.file this is what makes a pick a grant:
      // without it the user picks a file the app is still not allowed to read.
      .setAppId(opts.appId)
      .setOAuthToken(opts.accessToken)
      .addView(docs);
    if (!opts.mimeTypes) builder = builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    if (!narrow) {
      builder = builder.addView(
        new picker.DocsView(picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME),
      );
    }
    builder = builder
      .setCallback((data) => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.CANCEL) resolve(null);
        if (action !== picker.Action.PICKED) return;
        resolve(toPicked((data[picker.Response.DOCUMENTS] as PickerDocument[]) ?? [], picker));
      });
    if (opts.title) builder = builder.setTitle(opts.title);
    builder.build().setVisible(true);
  });
}

/**
 * Reduces the Picker's documents to `{id, kind}`.
 *
 * Names, URLs and everything else the Picker offers are dropped on purpose:
 * the server asks Drive for a file's metadata itself, and anything the browser
 * sent would only be a claim to check.
 */
export function toPicked(documents: PickerDocument[], picker: Pick<PickerNamespace, "Document">): PickedItem[] {
  return documents
    .map((d) => ({
      id: String(d[picker.Document.ID] ?? ""),
      kind: d[picker.Document.MIME_TYPE] === FOLDER_MIME ? ("folder" as const) : ("file" as const),
    }))
    .filter((d) => d.id !== "");
}

/** Why a Picker did not open, as a key under `apps.picker`. */
export type PickError = "reconnect" | "notConnected" | "failed";

/**
 * Fetches a Picker token and shows the Picker: the ids picked, null when the
 * learner closed it, or why it could not open.
 */
export async function pickFromDrive(
  config: { apiKey: string; appId: string },
  opts: Omit<OpenPickerOptions, "apiKey" | "appId" | "accessToken">,
): Promise<{ ids: string[] } | { error: PickError } | null> {
  try {
    const res = await fetch("/app/api/drive/picker-token", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (!res.ok || !body.access_token) {
      return {
        error: body.error === "needs_reconnect" ? "reconnect" : body.error === "not_connected" ? "notConnected" : "failed",
      };
    }
    const picked = await openDrivePicker({ ...opts, apiKey: config.apiKey, appId: config.appId, accessToken: body.access_token });
    return picked && picked.length > 0 ? { ids: picked.map((p) => p.id) } : null;
  } catch {
    return { error: "failed" };
  }
}
