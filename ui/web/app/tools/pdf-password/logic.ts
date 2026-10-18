/**
 * Add or remove a PDF password. Uses `@cantoo/pdf-lib` (a maintained fork of `pdf-lib`), not the
 * `pdf-lib` the other nine PDF tools in this repo use — that library has no `encrypt()` API at
 * all, and the fork's Unicode text-encoding change is unsafe for the tools that stamp text onto
 * a page (see `plan.md` Phase 0). Encryption never touches drawn text, so the fork is safe here
 * and nowhere else. Import stays dynamic so it never lands in another tool's bundle.
 */
import { ToolError } from '../shared/tool-error';

export class PdfPasswordError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'PdfPasswordError';
  }
}

const unreadable = (file: File) =>
  new PdfPasswordError('pdfUnreadable', `"${file.name}" could not be read as a PDF.`, {
    name: file.name,
  });

async function loadLib() {
  return import('@cantoo/pdf-lib');
}

export type LockPermissions = {
  printing: boolean;
  copying: boolean;
  modifying: boolean;
  annotating: boolean;
};

export type LockOptions = {
  userPassword: string;
  /** Restricts what the user password can do; opening still works without it. Optional. */
  ownerPassword?: string;
  permissions: LockPermissions;
};

export type LockResult = { blob: Blob; pages: number };

/** Encrypts a PDF with AES-256 and the given passwords/permissions. */
export async function lockPdf(file: File, options: LockOptions): Promise<LockResult> {
  const userPassword = options.userPassword.trim();
  if (!userPassword) {
    throw new PdfPasswordError('passwordRequired', 'Enter a password to lock the PDF with.');
  }

  const { PDFDocument, EncryptedPDFError } = await loadLib();
  let doc: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    doc = await PDFDocument.load(await file.arrayBuffer());
  } catch (e) {
    if (e instanceof EncryptedPDFError) {
      throw new PdfPasswordError(
        'alreadyLocked',
        `"${file.name}" already has a password. Remove it first, then add the new one.`,
        { name: file.name },
      );
    }
    throw unreadable(file);
  }

  const ownerPassword = options.ownerPassword?.trim() || undefined;
  const { printing, copying, modifying, annotating } = options.permissions;
  // Revision 3+ (which AES-256 always uses) reads `permissions` as a fresh, entirely-empty-by-
  // default object — leaving a field out denies it, it does not "leave it as before". Every
  // field the UI exposes is spelled out here so an unchecked box denies exactly what it says
  // and nothing else silently follows it down.
  doc.encrypt({
    userPassword,
    ownerPassword,
    algorithm: 'AES-256',
    permissions: {
      printing: printing ? 'highResolution' : false,
      copying,
      contentAccessibility: copying,
      modifying,
      documentAssembly: modifying,
      annotating,
      fillingForms: annotating,
    },
  });

  const bytes = await doc.save();
  return {
    blob: new Blob([bytes.slice()], { type: 'application/pdf' }),
    pages: doc.getPageCount(),
  };
}

async function openWithPassword(
  PDFDocument: Awaited<ReturnType<typeof loadLib>>['PDFDocument'],
  file: File,
  password: string,
) {
  const trimmed = password.trim();
  if (!trimmed) {
    throw new PdfPasswordError('unlockPasswordRequired', "Enter the PDF's password to remove it.");
  }
  try {
    return await PDFDocument.load(await file.arrayBuffer(), { password: trimmed });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/password incorrect/i.test(message)) {
      throw new PdfPasswordError('wrongPassword', `That password did not open "${file.name}".`, {
        name: file.name,
      });
    }
    throw unreadable(file);
  }
}

export type PdfInspection = { pages: number; fieldCount: number };

/**
 * Opens a locked PDF just far enough to report page count and whether it has form fields —
 * the things `unlockPdf` below cannot preserve. The widget calls this first so it can warn
 * before the lossy step runs, not after.
 */
export async function inspectLockedPdf(file: File, password: string): Promise<PdfInspection> {
  const { PDFDocument } = await loadLib();
  const opened = await openWithPassword(PDFDocument, file, password);
  let fieldCount = 0;
  try {
    fieldCount = opened.getForm().getFields().length;
  } catch {
    // A malformed /AcroForm dict throwing here is not a reason to fail the whole operation —
    // treat it as "nothing detected" and let unlockPdf itself be the source of truth.
    fieldCount = 0;
  }
  return { pages: opened.getPageCount(), fieldCount };
}

export type UnlockResult = { blob: Blob; pages: number };

/**
 * Removes a PDF's password. NOT `save()` on the decrypted document — that keeps the encryption
 * dictionary and re-emits an encrypted file. Pages are copied into a fresh, unencrypted document
 * instead, which is why form fields, annotations, the outline/bookmarks and document-level
 * metadata not attached to a page do not survive (`inspectLockedPdf` exists to warn about this
 * up front for form fields specifically).
 */
export async function unlockPdf(file: File, password: string): Promise<UnlockResult> {
  const { PDFDocument } = await loadLib();
  const opened = await openWithPassword(PDFDocument, file, password);
  const fresh = await PDFDocument.create();
  const pages = await fresh.copyPages(opened, opened.getPageIndices());
  for (const page of pages) fresh.addPage(page);
  const bytes = await fresh.save();
  return {
    blob: new Blob([bytes.slice()], { type: 'application/pdf' }),
    pages: fresh.getPageCount(),
  };
}
