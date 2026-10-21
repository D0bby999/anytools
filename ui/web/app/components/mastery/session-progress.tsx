import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ProgressBar } from "~/components/doc/progress-bar";

/** The live queue can grow; its total is the cards seen plus those still due. */
export function SessionProgress({ cardKey, remaining }: { cardKey: string; remaining: number }) {
  const { t } = useTranslation("study");
  const [position, setPosition] = useState({ key: cardKey, number: 1 });
  // A revalidation of the same card must not advance the displayed position.
  if (position.key !== cardKey) setPosition({ key: cardKey, number: position.number + 1 });
  const total = position.number + Math.max(0, remaining);
  const label = t("practise.cardOf", { n: position.number, total });
  return (
    <div className="mt-3 text-xs text-muted-foreground [&_.lp-progress-bar-track]:h-0.5">
      <ProgressBar value={position.number / total} label={label} valueText={label} />
    </div>
  );
}
