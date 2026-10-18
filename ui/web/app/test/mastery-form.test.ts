import { describe, expect, it } from "vitest";
import { parseApproval } from "~/lib/mastery-form";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("parseApproval", () => {
  it("keeps checked modules, one point per non-empty line, and carries each point's type", () => {
    const modules = parseApproval(
      form({
        modules: "2",
        types: JSON.stringify({ "Parametric memory": "memory" }),
        "module-0-keep": "on",
        "module-0-name": " Memory in RAG ",
        "module-0-objective": "Tell them apart",
        "module-0-threshold": "0.8",
        "module-0-points": "Parametric memory\n\n  Non-parametric memory  \n",
        "module-1-name": "Dropped",
        "module-1-points": "Anything",
      }),
    );
    expect(modules).toEqual([
      {
        name: "Memory in RAG",
        objective: "Tell them apart",
        pass_threshold: 0.8,
        knowledge_points: [
          { name: "Parametric memory", type: "memory" },
          { name: "Non-parametric memory", type: "concept" },
        ],
      },
    ]);
  });

  it("survives a tampered type map instead of throwing", () => {
    const modules = parseApproval(
      form({ modules: "1", types: "{not json", "module-0-keep": "on", "module-0-name": "M", "module-0-points": "P" }),
    );
    expect(modules[0]?.knowledge_points).toEqual([{ name: "P", type: "concept" }]);
  });
});
