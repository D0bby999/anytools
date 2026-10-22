/**
 * A session card is answered through a fetcher, and a fetcher's action
 * revalidates the page's loader. On a session page that loader is "what is
 * next", so the reload swapped the next card in about five seconds after the
 * verdict appeared, before it was read. These posts leave the loader alone;
 * the card's own Next button moves on.
 */
export function answerKeepsTheCard(formAction: string | undefined): boolean {
  return Boolean(formAction?.startsWith("/quiz/questions/") || formAction?.startsWith("/mastery/points/"));
}
