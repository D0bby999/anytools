/**
 * sentence.test.ts
 *
 * The API's Go-style errors are shown after a sentence of our own, and read
 * "No questions were written. your model…" until each is made a sentence.
 */
import { describe, expect, it } from "vitest";
import { asSentence } from "~/lib/sentence";

describe("asSentence", () => {
  it("capitalises, ends with a full stop and drops the dash", () => {
    expect(asSentence("your model did not return usable questions — try again")).toBe(
      "Your model did not return usable questions: try again.",
    );
  });

  it("leaves a finished sentence alone and an empty one empty", () => {
    expect(asSentence("Already fine!")).toBe("Already fine!");
    expect(asSentence("  ")).toBe("");
  });
});
