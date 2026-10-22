import { describe, expect, it } from "vitest";
import { NAV_TREE } from "~/lib/nav-tree";
import { activeSection, SETTINGS_GROUPS } from "~/components/settings/settings-nav";

describe("SETTINGS_GROUPS", () => {
  it("lists every Settings page of NAV_TREE, once, in its order", () => {
    const settings = NAV_TREE.find((group) => group.id === "settings")!.items.map((page) => page.to);
    expect(SETTINGS_GROUPS.flatMap((group) => group.sections.map((section) => section.to))).toEqual(settings);
  });
});

describe("activeSection", () => {
  it("is Connections only on /settings itself", () => {
    expect(activeSection("/settings")?.section.to).toBe("/settings");
    expect(activeSection("/settings/routes")?.section.to).toBe("/settings/routes");
  });

  it("keeps a section's children in that section", () => {
    expect(activeSection("/settings/providers/openai")?.section.to).toBe("/settings/providers");
    expect(activeSection("/settings/providers/openai")?.group.id).toBe("ai");
  });

  it("is nothing outside Settings", () => {
    expect(activeSection("/apps")).toBeUndefined();
  });
});
