/**
 * The composer's parts (plan 261021-1100 phase 2): the context meter, the
 * model chip's search and the shortcuts dialog.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "~/lib/i18n";
import { ContextMeter, compactTokens } from "~/components/chat/composer/context-meter";
import { ModelChip } from "~/components/chat/composer/model-chip";
import { ShortcutHelpDialog } from "~/components/chat/shortcut-help-dialog";

beforeAll(() => {
  initI18n("en");
});

describe("context meter", () => {
  it("says in words how full the window was and where summarising starts", () => {
    render(<ContextMeter used={3200} window={32768} budget={16384} />);
    const meter = screen.getByRole("meter", { name: "Context used" });
    expect(meter).toHaveAttribute("aria-valuenow", "3200");
    expect(meter).toHaveAttribute("aria-valuetext", "About 3.2k of 32.8k tokens (10%) went into the last question.");
    expect(screen.getByText("Past about 16.4k tokens of earlier messages, the oldest are summarised.")).toHaveClass("sr-only");
  });

  it("draws nothing without numbers", () => {
    const { container } = render(<ContextMeter used={0} window={32768} />);
    expect(container).toBeEmptyDOMElement();
    expect(compactTokens(1_048_576)).toBe("1M");
  });
});

describe("model chip", () => {
  it("offers a search past five models and filters without diacritics", async () => {
    const models = ["Một", "Two", "Three", "Four", "Five", "Six"].map((n, i) => ({ id: `c${i}`, name: n, model: `m${i}` }));
    const onChange = vi.fn();
    render(<ModelChip models={models} value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Model: Một, m0" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a model" }), "mot");
    expect(screen.getAllByRole("menuitemradio").map((m) => m.textContent)).toEqual(["Mộtm0"]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is absent with no connection on the chat route", () => {
    const { container } = render(<ModelChip models={[]} value="" onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("shortcuts dialog", () => {
  it("lists the keys, Mod as Ctrl off a Mac, and closes", async () => {
    const onClose = vi.fn();
    render(<ShortcutHelpDialog open onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.getByText("Find in this conversation").nextElementSibling?.textContent).toBe("CtrlF");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
