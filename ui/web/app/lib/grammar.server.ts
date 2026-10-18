/**
 * grammar.server.ts
 * "Start a contrast card" on a row of the grammar error map (up methods,
 * phase 6): the grammar evidence worksheet started from that row before,
 * found by its title on the same goal, or a new one on the map's goal,
 * prefilled from the row.
 */
import * as worksheets from "~/lib/worksheets.server";
import {
  GRAMMAR_EVIDENCE_KIND,
  GRAMMAR_MAP_KIND,
  contrastCardAnswers,
  contrastCardTitle,
  type ErrorRow,
} from "~/lib/grammar";

/** The opened card's id, or the locale key of why it cannot be opened. */
export type OpenedCard = { id: string } | { errorKey: string };

export async function startContrastCard(userId: string, mapId: string, row: ErrorRow): Promise<OpenedCard> {
  if (!row.sample) return { errorKey: "grammar.needsSample" };
  const [{ worksheet: map }, kinds] = await Promise.all([
    worksheets.getWorksheet(userId, mapId),
    worksheets.listKinds(userId),
  ]);
  if (map.kind !== GRAMMAR_MAP_KIND) return { errorKey: "grammar.notAMap" };
  const card = kinds.find((k) => k.kind === GRAMMAR_EVIDENCE_KIND);
  if (!card) return { errorKey: "grammar.cannotStart" };
  // The card attaches to a goal only: a map kept on a document starts an
  // unattached card.
  const stateId = card.attach === "state" ? map.state_id : undefined;
  const title = contrastCardTitle(card, row.sample);

  const existing = (await worksheets.listWorksheets(userId, { kind: card.kind, ...(stateId ? { stateId } : {}) })).find(
    (w) => w.title === title && (w.state_id ?? "") === (stateId ?? ""),
  );
  if (existing) return { id: existing.id };

  const created = await worksheets.createWorksheet(userId, {
    kind: card.kind,
    title,
    ...(stateId ? { state_id: stateId } : {}),
  });
  const answers = contrastCardAnswers(card, row);
  if (Object.keys(answers).length > 0) {
    await worksheets.patchWorksheet(userId, created.id, { revision: created.updated_at, answers });
  }
  return { id: created.id };
}
