/**
 * doc-patterns.test.tsx
 * The pattern library every page is assembled from while the app takes
 * byoungd/up's shape (plan a private plan, phase 07,
 * reports/feature-ui-spec.md tables P and I). One test per pattern for what a
 * screen reader and a keyboard meet: roles, names, `aria-*`, and the three
 * behaviours with rules of their own — the choice rows' keys (I1), copying a
 * code block (I8) and the dialog's focus trap and return (I12) — plus the
 * worksheet copy's success and failure lines and the 404 page.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useState, type ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { AtAGlance } from "~/components/doc/at-a-glance";
import { NumberedSection, slugify } from "~/components/doc/numbered-section";
import { BookMeta } from "~/components/doc/book-meta";
import { QuickStart } from "~/components/doc/quick-start";
import { GuidePaths } from "~/components/doc/guide-paths";
import { DatedList } from "~/components/doc/dated-list";
import { RefTable } from "~/components/doc/ref-table";
import { DownloadGrid } from "~/components/doc/download-grid";
import { ChoiceRow, type Choice } from "~/components/doc/choice-row";
import { FieldTable } from "~/components/doc/field-table";
import { Field } from "~/components/doc/field";
import { Badge } from "~/components/doc/badge";
import { Details } from "~/components/doc/details";
import { CodeBlock } from "~/components/doc/code-block";
import { StatusLine } from "~/components/doc/status-line";
import { Dialog } from "~/components/doc/dialog";
import { ProgressBar } from "~/components/doc/progress-bar";
import { WorksheetActions } from "~/components/doc/worksheet-actions";
import { Closing } from "~/components/doc/closing";
import { NotFound } from "~/components/doc/not-found";
import { PageHeader } from "~/components/ui/page-header";
import { Plate, PlateEmpty } from "~/components/ui/plate";

beforeAll(() => {
  initI18n("en");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const inRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("P1 · at a glance and numbered sections", () => {
  it("is a section named by its own h2, holding a list", () => {
    render(<AtAGlance items={["One", "Two"]} />);
    const region = screen.getByRole("region", { name: "At a glance" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
  });

  it("numbers its h2 and gives it an id the outline can reach", () => {
    render(
      <NumberedSection n={2} title="Đặt mục tiêu">
        <p>Body</p>
      </NumberedSection>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "2. Đặt mục tiêu" });
    expect(heading.id).toBe("2-dat-muc-tieu");
    expect(screen.getByRole("region", { name: "2. Đặt mục tiêu" })).toContainElement(heading);
    expect(slugify("Hello, World!")).toBe("hello-world");
  });
});

describe("I5 · book-meta", () => {
  it("is a named list of facts, a fact with a page a link", () => {
    inRouter(<BookMeta label="Your numbers" items={[{ label: "12 due", to: "/vocab" }, { label: "3 documents" }]} />);
    const list = screen.getByRole("list", { name: "Your numbers" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByRole("link", { name: "12 due" })).toHaveAttribute("href", "/vocab");
  });
});

describe("I3 · quick-start", () => {
  it("has a heading, one primary and at most two secondary actions, and marks done steps in words", () => {
    inRouter(
      <QuickStart
        title="Review your cards"
        description="Twelve are due."
        primary={{ label: "Review 12 due cards", to: "/vocab/review" }}
        secondary={[
          { label: "Read", to: "/knowledge" },
          { label: "Ask", to: "/chat" },
          { label: "Never shown", to: "/x" },
        ]}
        cycle="Read · Ask · Practise · Reflect"
        steps={[{ label: "Add a document", done: true }, { label: "Set a goal", to: "/loop" }]}
        stepsLabel="Finish setting up"
        doneLabel="done"
      />,
    );
    const region = screen.getByRole("region", { name: "Review your cards" });
    const links = within(region).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Set a goal", "Review 12 due cards", "Read", "Ask"]);
    expect(within(region).getByRole("link", { name: "Review 12 due cards" })).toHaveClass("lp-quick-start-action-primary");
    const steps = within(region).getByRole("list", { name: "Finish setting up" });
    expect(within(steps).getAllByRole("listitem")[0]).toHaveTextContent("Add a document (done)");
    expect(within(region).getByText("Read · Ask · Practise · Reflect")).toBeInTheDocument();
    // No label above the title (design-world refuse list, owner 2026-10-21).
    expect(region.querySelector(".lp-kicker")).toBeNull();
    expect(region.firstElementChild?.firstElementChild?.tagName).toBe("H2");
  });
});

describe("P7 · guide-paths", () => {
  it("draws each group as a named region of link cards, and marks the external group", () => {
    inRouter(
      <GuidePaths
        groups={[
          { id: "read", kicker: "01", title: "Read", paths: [{ title: "Knowledge", description: "Your library.", to: "/knowledge" }] },
          { id: "appendix", kicker: "A", title: "Appendix", external: true, paths: [{ title: "Free tools", description: "137 tools.", to: "/" }] },
        ]}
      />,
    );
    const read = screen.getByRole("region", { name: "Read" });
    expect(within(read).getByRole("link", { name: /Knowledge/ })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByRole("region", { name: "Appendix" })).toHaveAttribute("data-variant", "external");
  });
});

describe("P4 · dated list", () => {
  it("reads date · title · note", () => {
    inRouter(<DatedList label="Latest" items={[{ date: "19 Oct 2026", title: "Notes", to: "/n", note: "a summary" }]} />);
    const item = within(screen.getByRole("list", { name: "Latest" })).getByRole("listitem");
    expect(item).toHaveTextContent("19 Oct 2026 · Notes · a summary");
    expect(within(item).getByRole("link", { name: "Notes" })).toHaveAttribute("href", "/n");
  });
});

describe("P5 · reference table", () => {
  it("is a captioned table with column and row headers", () => {
    render(<RefTable caption="Glossary" columns={["Term", "Meaning"]} rows={[["Recall", "Bringing it back"]]} />);
    const table = screen.getByRole("table", { name: "Glossary" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(within(table).getByRole("rowheader", { name: "Recall" })).toBeInTheDocument();
  });
});

describe("P6 · download grid", () => {
  it("gives each card a heading that names it", () => {
    render(<DownloadGrid cards={[{ id: "md", title: "Markdown", description: "Plain text.", action: <a href="/x.md">Get</a> }]} />);
    const card = screen.getByRole("region", { name: "Markdown" });
    expect(within(card).getByRole("link", { name: "Get" })).toBeInTheDocument();
  });
});

describe("I1 · choice rows", () => {
  const CHOICES: Choice[] = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
  ];

  function Harness({ choices = CHOICES, role }: { choices?: Choice[]; role?: "radiogroup" | "listbox" }) {
    const [value, setValue] = useState<string | null>(null);
    return <ChoiceRow choices={choices} value={value} onChange={setValue} label="Answer" role={role} />;
  }

  it("is a radio group with one tab stop", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Answer" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(radios.every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("moves and chooses with ↑↓, wraps, and chooses by number", () => {
    render(<Harness />);
    const radios = screen.getAllByRole("radio");
    fireEvent.keyDown(radios[0]!, { key: "ArrowDown" });
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveFocus();
    expect(radios[1]).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(radios[1]!, { key: "ArrowUp" });
    fireEvent.keyDown(radios[0]!, { key: "ArrowUp" });
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios[2]!, { key: "1" });
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[0]).toHaveFocus();
    fireEvent.keyDown(radios[0]!, { key: "9" });
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
  });

  it("says right and wrong in words, not colour alone", () => {
    render(
      <Harness
        choices={[
          { id: "a", label: "Alpha", state: "wrong" },
          { id: "b", label: "Beta", state: "correct" },
        ]}
      />,
    );
    const [a, b] = screen.getAllByRole("radio");
    expect(a).toHaveTextContent("Incorrect");
    expect(a).toHaveAttribute("data-state", "wrong");
    expect(b).toHaveTextContent("Correct");
  });

  it("can be a listbox of options", () => {
    render(<Harness role="listbox" />);
    const options = within(screen.getByRole("listbox", { name: "Answer" })).getAllByRole("option");
    fireEvent.click(options[2]!);
    expect(options[2]).toHaveAttribute("aria-selected", "true");
  });
});

describe("I2 · field table", () => {
  it("labels every input by its row and column and lists column help below", () => {
    const onChange = vi.fn();
    render(
      <FieldTable
        caption="Weekly review"
        rowHeader="Area"
        columns={[{ key: "win", label: "Win", hint: "One sentence." }, { key: "next", label: "Next", multiline: true }]}
        rows={[{ key: "work", label: "Work" }]}
        values={{ work: { win: "Shipped" } }}
        onChange={onChange}
      />,
    );
    const table = screen.getByRole("table", { name: "Weekly review" });
    const win = within(table).getByRole("textbox", { name: "Work, Win" });
    expect(win).toHaveValue("Shipped");
    fireEvent.change(within(table).getByRole("textbox", { name: "Work, Next" }), { target: { value: "Rest" } });
    expect(onChange).toHaveBeenCalledWith("work", "next", "Rest");
    expect(within(table).getByRole("rowheader", { name: "Work" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("Win: One sentence.");
  });
});

describe("I4 · field", () => {
  it("ties its label, hint and error to the control", () => {
    render(
      <Field label="Title" hint="Shown in the list." error="Required.">
        <input type="text" />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Title" });
    expect(input).toHaveAccessibleDescription("Shown in the list. Required.");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});

describe("I6 · badge", () => {
  it("carries its type", () => {
    render(<Badge type="warning">Due</Badge>);
    expect(screen.getByText("Due")).toHaveAttribute("data-type", "warning");
  });
});

describe("I7 · details", () => {
  it("is a native disclosure that opens on its summary", () => {
    render(
      <Details summary="Advanced">
        <p>Hidden</p>
      </Details>,
    );
    const summary = screen.getByText("Advanced");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
  });
});

describe("I8 · code block", () => {
  it("copies its text and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<CodeBlock code={"# Weekly\n- one"} lang="md" />);
    const button = screen.getByRole("button", { name: "Copy code" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledWith("# Weekly\n- one");
    expect(screen.getByRole("button", { name: "Copied" })).toHaveAttribute("data-copied", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });
});

describe("I11 · status line", () => {
  it("is a live status, red only for an error", () => {
    render(<StatusLine tone="error">Failed.</StatusLine>);
    expect(screen.getByRole("status")).toHaveTextContent("Failed.");
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "error");
  });
});

describe("I12 · dialog", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Delete
        </button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Delete this note?"
          description="It cannot be undone."
          actions={
            <>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button">Delete note</button>
            </>
          }
        />
      </div>
    );
  }

  it("is a named modal that keeps the focus inside, makes the page inert, and gives the focus back", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Delete" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Delete this note?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("It cannot be undone.");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", { name: "Delete note" });
    expect(cancel).toHaveFocus();
    expect(opener.closest("body > div")).toHaveProperty("inert", true);

    confirm.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(opener.closest("body > div")).toHaveProperty("inert", false);
  });
});

describe("progress bar", () => {
  it("is a meter with its value in words beside it", () => {
    render(<ProgressBar value={0.44} threshold={0.7} label="Mastery" />);
    const meter = screen.getByRole("meter", { name: "Mastery" });
    expect(meter).toHaveAttribute("aria-valuenow", "44");
    expect(screen.getByText("44%")).toBeInTheDocument();
  });
});

describe("closing", () => {
  it("is a complementary block with its theme line", () => {
    render(<Closing theme="Keep going." signoff="See you tomorrow." />);
    expect(screen.getByRole("complementary")).toHaveTextContent("Keep going.See you tomorrow.");
  });
});

describe("worksheet actions", () => {
  it("links the Markdown download", () => {
    render(<WorksheetActions href="/toolkit/w1/export.md" />);
    const region = screen.getByRole("region", { name: "Use this worksheet" });
    expect(within(region).getByRole("link", { name: "Download Markdown" })).toHaveAttribute("href", "/toolkit/w1/export.md");
    expect(within(region).getByRole("status")).toHaveTextContent("");
  });

  it("copies the export and says where to paste it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("# Worksheet", { status: 200 })));
    render(<WorksheetActions href="/toolkit/w1/export.md" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy worksheet" }));
    });
    expect(fetch).toHaveBeenCalledWith("/toolkit/w1/export.md", expect.objectContaining({ signal: expect.anything() }));
    expect(writeText).toHaveBeenCalledWith("# Worksheet");
    expect(screen.getByRole("status")).toHaveTextContent("Copied. Paste into your private notes.");
    expect(screen.getByRole("status")).not.toHaveAttribute("data-tone");
  });

  it("points to the download when the copy fails", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    render(<WorksheetActions href="/toolkit/w1/export.md" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy worksheet" }));
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Copy was unavailable. Use the Markdown download instead.");
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "error");
    expect(screen.getByRole("button", { name: "Copy worksheet" })).toBeEnabled();
  });
});

describe("page header", () => {
  it("is the page's h1 with an id, its lede and its actions, without the numeral", () => {
    render(<PageHeader title="Knowledge" lede="Your library." numeral="I" actions={<button type="button">Add</button>} />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Knowledge" });
    expect(h1).toHaveAttribute("id", "page-title");
    expect(screen.getByText("Your library.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.queryByText("I")).not.toBeInTheDocument();
  });
});

describe("plates", () => {
  it("draws the part's plate, decorative, and a first-run empty state beside its sentence", () => {
    const { container } = render(
      <>
        <Plate name="part-read" />
        <PlateEmpty name="part-read">Nothing here yet.</PlateEmpty>
      </>,
    );
    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.getAttribute("src")).toContain("part-read");
      expect(image).toHaveAttribute("alt", "");
    }
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
});

describe("404", () => {
  it("is a page with the code, a title and one way home", () => {
    render(<NotFound />);
    expect(screen.getByRole("main")).toHaveTextContent("404");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/home");
  });
});
