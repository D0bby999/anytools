/**
 * apps-classroom.test.tsx
 * Learning apps → Google Classroom (learning-tool-connections phase 6): what
 * the page shows for a school that blocks AnyLearn, a class not yet linked,
 * and a linked class, whose not-yet-imported items start ticked.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/auth.server", () => ({ requireUser: vi.fn() }));
vi.mock("~/lib/drive.server", () => ({ loadDrive: vi.fn(), importFromDrive: vi.fn() }));
vi.mock("~/lib/kb.server", () => ({ listKBs: vi.fn() }));
vi.mock("~/lib/classroom.server", () => ({
  listCourses: vi.fn(),
  listItems: vi.fn(),
  linkCourse: vi.fn(),
  importItems: vi.fn(),
  markSeen: vi.fn(),
}));
vi.mock("~/lib/api.server", () => ({ ApiError: class extends Error {} }));

const page = await import("~/routes/apps.classroom");
const { initI18n } = await import("~/lib/i18n");

beforeAll(() => {
  initI18n("en");
});

const feature = { id: "classroom", scopes: [], sensitive: true, available: true, granted: true };
const base = { picker: { apiKey: "k", appId: "1" }, connected: true, feature, kbs: [{ id: "kb1", name: "Biology" }], error: null };
const course = { id: "c1", name: "Biology 10A", section: "Period 2", new: 2 };

function show(loaderData: unknown) {
  const Stub = createRoutesStub([{ path: "/apps/classroom", Component: page.default as never, loader: () => loaderData }]);
  render(<Stub initialEntries={["/apps/classroom?course=c1"]} />);
}

describe("Google Classroom page", () => {
  it("says what a school administrator has to allow", async () => {
    show({ ...base, courses: [], items: null, course: null, error: "school_blocked" });
    expect(await screen.findByRole("heading", { name: /school has not allowed AnyLearn/ })).toBeInTheDocument();
    expect(screen.getByText(/App access control/)).toBeInTheDocument();
  });

  it("asks where a class not yet linked should go, a new base by default", async () => {
    show({ ...base, courses: [course], items: [], course, error: null });
    expect(await screen.findByRole("option", { name: "A new knowledge base: Biology 10A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bring this class in" })).toBeInTheDocument();
  });

  it("ticks what was not imported yet, and counts the ticks", async () => {
    const linked = { ...course, kb_id: "kb1" };
    const items = [
      { key: "drive:1", kind: "drive", title: "week3.pdf", from: "Week 3", imported: false },
      { key: "youtube:x", kind: "youtube", title: "Lecture", from: "Week 3", imported: false },
      { key: "post:a1", kind: "post", title: "Exam moved", from: "Exam moved", imported: true },
    ];
    show({ ...base, courses: [linked], items, course: linked, error: null });
    const button = await screen.findByRole("button", { name: "Import 2 items" });
    fireEvent.click(screen.getByRole("checkbox", { name: /Lecture/ }));
    expect(button).toHaveTextContent("Import 1 item");
    expect(screen.getByRole("checkbox", { name: /Exam moved/ })).not.toBeChecked();
  });

  it("offers the permission while Google has not granted it", async () => {
    show({ ...base, feature: { ...feature, granted: false }, courses: [], items: null, course: null });
    expect(await screen.findByRole("link", { name: "Allow Google Classroom" })).toHaveAttribute(
      "href",
      "/auth/drive?next=%2Fapps%2Fclassroom&add=classroom",
    );
  });
});
