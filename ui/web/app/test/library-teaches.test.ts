/**
 * library-teaches.test.ts
 * Which language an item is for learning (the private design notes,
 * phase 6): read from the title, conservatively.
 */
import { describe, expect, it } from "vitest";
import { teachesOf } from "~/lib/library/teaches";

const book = (name: string, extra: Record<string, string> = {}) =>
  teachesOf({ kind: "textbook", subject: "languages", language: "en", name, ...extra } as never);

describe("teachesOf", () => {
  it("reads a course's language from its title", () => {
    expect(book("Elementary Arabic I")).toBe("ar");
    expect(book("Let's Chat! Korean")).toBe("ko");
    expect(book("German 101")).toBe("de");
    expect(book("Chinese I (Regular)")).toBe("zh");
    expect(book("Spunti: Italiano elementare 1")).toBe("it");
    expect(book("Spanish for Bilingual Students")).toBe("es");
  });

  it("shelves English for learners, never a book for teachers", () => {
    expect(book("Oral Communication for Non-Native Speakers of English")).toBe("en");
    expect(book("Advanced Speaking and Critical Listening Skills (ELS)")).toBe("en");
    expect(book("Language Landscapes: The ESL teacher's guide to how English works")).toBeUndefined();
    expect(book("Teaching Pronunciation with Confidence: A Resource for ESL/EFL Teachers")).toBeUndefined();
  });

  it("leaves linguistics, literature and other subjects untagged", () => {
    expect(book("Introduction to Phonology")).toBeUndefined();
    expect(book("French Film Classics")).toBeUndefined();
    expect(teachesOf({ kind: "textbook", subject: "science", language: "en", name: "Basic French" } as never)).toBeUndefined();
  });

  it("gives a word list or a deck its own language", () => {
    expect(teachesOf({ kind: "words", subject: "languages", language: "ja", name: "JLPT" } as never)).toBe("ja");
    expect(teachesOf({ kind: "deck", subject: "languages", language: "mul", name: "Many" } as never)).toBeUndefined();
  });
});
