/**
 * photo-sources.test.tsx
 * Up-methods phase 16: photos of pages and notes as sources. Several photos
 * can be one document in the order the learner sets; a photo document reads
 * each photo beside its text; a citation says it was read from a photo.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { UploadDropzone } from "~/components/knowledge/upload-dropzone";
import { PhotoPages } from "~/components/reading/photo-pages";
import { CitationChip } from "~/components/chat/citation-chip";
import { ACCEPTED_EXTENSIONS, isPhotoMime, PHOTO_SET_MIME } from "~/lib/kb-types";
import type { PhotoCodec } from "~/lib/image-resize";

beforeAll(() => {
  initI18n("en");
});

// jsdom's File does not survive React Router's FormData into the action, so
// the action counts the parts and the codec records which photos were
// prepared, in the order they were put in the form.
type Post = { to: "page" | "stream"; intent: string | null; oneDocument: string | null; parts: number };

/** The dropzone on a knowledge base page, recording what it posts. */
function renderDropzone(codec: PhotoCodec) {
  const posts: Post[] = [];
  // Both places an upload can go: one file or a one-document photo set is
  // streamed through the upload route (up-methods phase 15); several separate
  // files go to the page action, which sends them one by one.
  const record = (to: Post["to"]) => async ({ request }: { request: Request }) => {
    const form = await request.formData();
    posts.push({
      to,
      intent: form.get("intent") as string | null,
      oneDocument: form.get("one_document") as string | null,
      parts: form.getAll("file").length,
    });
    return { uploaded: "x" };
  };
  const router = createMemoryRouter(
    [
      { path: "/knowledge/:kbId", element: <UploadDropzone kbId="kb-1" codec={codec} />, action: record("page") },
      { path: "/knowledge/:kbId/upload", action: record("stream") },
    ],
    { initialEntries: ["/knowledge/kb-1"] },
  );
  render(<RouterProvider router={router} />);
  return posts;
}

/** A codec that scales nothing, re-encodes a camera photo, and records the order. */
function recordingCodec() {
  const prepared: string[] = [];
  const encoded: string[] = [];
  const codec: PhotoCodec = {
    async decode(file) {
      const name = (file as File).name;
      prepared.push(name);
      return { width: 1000, height: 800, source: { name } as unknown as CanvasImageSource };
    },
    async encode(photo) {
      encoded.push((photo.source as unknown as { name: string }).name);
      return new Blob(["re-encoded"], { type: "image/jpeg" });
    },
  };
  return { codec, prepared, encoded };
}
const passThrough = recordingCodec().codec;

/** A photo whose bytes are its name. */
function photoFile(name: string, type: string) {
  return new File([name], name, { type });
}

describe("UploadDropzone with photos", () => {
  it("offers photos in the picker and takes several files", () => {
    renderDropzone(passThrough);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(true);
    for (const ext of [".png", ".jpg", ".jpeg", ".webp", ".heic"]) {
      expect(ACCEPTED_EXTENSIONS as readonly string[]).toContain(ext);
      expect(input.accept).toContain(ext);
    }
  });

  it("adds photos as one document in the order the learner sets", async () => {
    const user = userEvent.setup();
    const { codec, prepared, encoded } = recordingCodec();
    const posts = renderDropzone(codec);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, [
      photoFile("p1.png", "image/png"),
      photoFile("p2.png", "image/png"),
      photoFile("p3.heic", "image/heic"),
    ]);

    // Nothing is sent until the learner says how the photos belong.
    expect(screen.getByText("3 photos chosen")).toBeInTheDocument();
    expect(posts).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Move p3.heic up" }));
    await user.click(screen.getByRole("checkbox", { name: "These photos are one document" }));
    await user.click(screen.getByRole("button", { name: "Add the photos" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.oneDocument).toBe("true");
    expect(posts[0]!.to).toBe("stream");
    expect(posts[0]!.intent).toBe("upload");
    // Every photo went through the browser's preparation, in the order set.
    expect(posts[0]!.parts).toBe(3);
    expect(prepared).toEqual(["p1.png", "p3.heic", "p2.png"]);
    // Only the camera photo was re-encoded; the PNGs are small enough as they are.
    expect(encoded).toEqual(["p3.heic"]);
  });

  it("adds each photo as its own document by default", async () => {
    const user = userEvent.setup();
    const { codec, prepared } = recordingCodec();
    const posts = renderDropzone(codec);
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, [
      photoFile("a.png", "image/png"),
      photoFile("b.png", "image/png"),
    ]);
    await user.click(screen.getByRole("button", { name: "Add the photos" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.oneDocument).toBeNull();
    expect(posts[0]!.to).toBe("page");
    expect(posts[0]!.parts).toBe(2);
    expect(prepared).toEqual(["a.png", "b.png"]);
  });

  it("refuses more than 30 photos as one document before sending", async () => {
    const user = userEvent.setup();
    const posts = renderDropzone(passThrough);
    const many = Array.from({ length: 31 }, (_, i) => photoFile(`p${i}.png`, "image/png"));
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, many);
    await user.click(screen.getByRole("checkbox", { name: "These photos are one document" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at most 30 photos");
    expect(screen.getByRole("button", { name: "Add the photos" })).toBeDisabled();
    expect(posts).toHaveLength(0);
  });

  it("sends a single file at once, as before", async () => {
    const user = userEvent.setup();
    const posts = renderDropzone(passThrough);
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(["%PDF-1.4"], "paper.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.parts).toBe(1);
    expect(posts[0]!.oneDocument).toBeNull();
    expect(posts[0]!.to).toBe("stream");
    expect(screen.queryByText(/photos chosen/)).toBeNull();
  });

  it("refuses a recording chosen with other files, because those are held in memory", async () => {
    const user = userEvent.setup();
    const posts = renderDropzone(passThrough);
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, [
      new File(["%PDF-1.4"], "paper.pdf", { type: "application/pdf" }),
      new File(["ID3"], "lecture.mp3", { type: "audio/mpeg" }),
    ]);
    expect(await screen.findByRole("alert")).toHaveTextContent("lecture.mp3 is audio or video");
    expect(posts).toHaveLength(0);
  });
});

describe("PhotoPages", () => {
  it("shows each page's photo beside its text, on the citation anchors", () => {
    render(
      <PhotoPages
        docId="doc-7"
        pages={[
          { page: 1, markdown: "Light reactions" },
          { page: 2, markdown: "Calvin cycle | stroma" },
        ]}
      />,
    );
    const second = document.getElementById("page-2")!;
    expect(second).toHaveAttribute("data-page", "2");
    const img = within(second).getByRole("img", { name: "Photo of page 2" });
    expect(img).toHaveAttribute("src", "/documents/doc-7/photo?page=2");
    expect(within(second).getByText("Calvin cycle | stroma")).toBeInTheDocument();
    expect(document.getElementById("page-1")).not.toBeNull();
  });
});

describe("photo documents and citations", () => {
  it("knows a photo document by its type", () => {
    expect(isPhotoMime(PHOTO_SET_MIME)).toBe(true);
    expect(isPhotoMime("image/heic")).toBe(true);
    expect(isPhotoMime("application/pdf")).toBe(false);
  });

  it("says a passage was read from a photo, and by which model", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <CitationChip
              index={1}
              source={{ kind: "chunk", id: "c1", title: "IMG_2041.jpg", page: 2, document_id: "doc-7", photo_model: "gemini-3.6-flash" }}
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/documents/doc-7?page=2");
    expect(link).toHaveTextContent("from a photo");
    expect(link).toHaveAccessibleName("1: Open IMG_2041.jpg, page 2 (read by gemini-3.6-flash from a photo)");
  });
});
