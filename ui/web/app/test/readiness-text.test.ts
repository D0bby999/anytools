// @vitest-environment node
/**
 * readiness-text.test.ts
 * The readiness matrix's sentences follow the learner's language by code,
 * with the API's English as the fallback for a code this build does not know.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n, loadLanguage } from "~/lib/i18n";
import { entryNote, rowReason } from "~/lib/readiness-text";
import type { FunctionReadiness } from "~/lib/byok.types";

const row = (over: Partial<FunctionReadiness>): FunctionReadiness => ({ function: "parse", status: "blocked", reason: "", entries: [], ...over });

beforeAll(async () => {
  initI18n("en");
  await loadLanguage("vi");
});

describe("readiness sentences", () => {
  it("word a code in the learner's language, with the function's own name", () => {
    const vi = initI18n("vi").getFixedT("vi", "common");
    const r = row({ reason: "No parse route. Choose a connection for it in Settings → Routes.", reason_code: "no_route" });
    expect(rowReason(vi, r)).toBe("Chưa có kết nối nào làm việc Đọc tài liệu. Hãy chọn một kết nối trong Cài đặt → Phân việc.");
  });

  it("borrow a warning entry's note for the row, provider and detail included", () => {
    const en = initI18n("en").getFixedT("en", "common");
    const entry = { connection_id: "c", name: "", provider: "openai", model: "", status: "warn" as const, note: "Key rejected. 401", note_code: "key_rejected", detail: "401" };
    const r = row({ status: "warn", reason: "Key rejected. 401", reason_code: "key_rejected", entries: [entry] });
    expect(rowReason(en, r)).toBe("Key rejected. 401");
    expect(entryNote(en, r, entry)).toBe("Key rejected. 401");
  });

  it("fall back to the API's English for an unknown code or none", () => {
    const vi = initI18n("vi").getFixedT("vi", "common");
    expect(rowReason(vi, row({ reason: "Something new.", reason_code: "brand_new" }))).toBe("Something new.");
    expect(rowReason(vi, row({ reason: "Old API sentence." }))).toBe("Old API sentence.");
  });
});
