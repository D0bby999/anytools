/**
 * worksheet-option-labels.test.tsx
 * A kind served in another language names its options in option_labels: the
 * form shows those words and still stores the English value the kind
 * validates (internal/learning/worksheet/localize.go).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "~/lib/i18n";
import { FieldInput } from "~/components/worksheet/field-input";
import type { WorksheetField } from "~/lib/worksheet-types";

beforeAll(async () => {
  await initI18n("en");
});

const labels = { work: "công việc", study: "học tập" };

describe("translated options", () => {
  it("shows a choice's translation and stores its value", () => {
    const field: WorksheetField = { key: "context", label: "Bối cảnh", type: "choice", options: ["work", "study"], option_labels: labels };
    const onChange = vi.fn();
    render(<FieldInput id="f" field={field} value={undefined} onChange={onChange} />);
    expect(screen.getByRole("option", { name: "học tập" })).toHaveValue("study");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "study" } });
    expect(onChange).toHaveBeenCalledWith("study");
  });

  it("shows a multi's translations and stores their values", () => {
    const field: WorksheetField = { key: "help", label: "Trợ giúp", type: "multi", options: ["work", "study"], option_labels: labels };
    const onChange = vi.fn();
    render(<FieldInput id="m" field={field} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "công việc" }));
    expect(onChange).toHaveBeenCalledWith(["work"]);
  });

  it("falls back to the value where no translation is given", () => {
    const field: WorksheetField = { key: "lvl", label: "Level", type: "choice", options: ["B2"] };
    render(<FieldInput id="l" field={field} value={undefined} onChange={() => {}} />);
    expect(screen.getByRole("option", { name: "B2" })).toHaveValue("B2");
  });
});
