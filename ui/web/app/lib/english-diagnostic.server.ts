/**
 * english-diagnostic.server.ts
 * §5's "Evidence card" (up methods, phase 1): open the skill's full evidence
 * worksheet from a diagnostic — the one opened from it before, found by its
 * title on the same goal, or a new one attached to the diagnostic's goal with
 * its first section prefilled with the barrier.
 */
import * as worksheets from "~/lib/worksheets.server";
import {
  DIAGNOSTIC_KIND,
  clampPrefill,
  evidenceTarget,
  evidenceTitle,
  prefillTarget,
} from "~/lib/english-diagnostic";

/** The opened worksheet's id, or the locale key of why it cannot be opened from here. */
export type OpenedEvidence = { id: string } | { errorKey: string };

export async function openEvidenceWorksheet(
  userId: string,
  diagnosticId: string,
  skill: string,
  prefill: string,
): Promise<OpenedEvidence> {
  const [{ worksheet: diagnostic }, kinds] = await Promise.all([
    worksheets.getWorksheet(userId, diagnosticId),
    worksheets.listKinds(userId),
  ]);
  if (diagnostic.kind !== DIAGNOSTIC_KIND) return { errorKey: "diagnostic.notADiagnostic" };
  const target = evidenceTarget(skill, kinds);
  if (target.mode !== "open") return { errorKey: "diagnostic.cannotOpen" };
  const kind = target.kind;
  const stateId = kind.attach === "state" ? diagnostic.state_id : undefined;
  const title = evidenceTitle(kind, diagnostic.title);

  const existing = (await worksheets.listWorksheets(userId, { kind: kind.kind, ...(stateId ? { stateId } : {}) })).find(
    (w) => w.title === title && (w.state_id ?? "") === (stateId ?? ""),
  );
  if (existing) return { id: existing.id };

  const created = await worksheets.createWorksheet(userId, {
    kind: kind.kind,
    title,
    ...(stateId ? { state_id: stateId } : {}),
  });
  const spot = prefillTarget(kind);
  const text = spot ? clampPrefill(spot.field, prefill) : "";
  if (spot && text) {
    await worksheets.patchWorksheet(userId, created.id, {
      revision: created.updated_at,
      answers: { [spot.section.key]: { [spot.field.key]: text } },
    });
  }
  return { id: created.id };
}
