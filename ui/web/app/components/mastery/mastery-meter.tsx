import { ProgressBar } from "~/components/doc/progress-bar";

/** Keep module progress and its passing threshold on the shared six-pixel meter. */
export function MasteryMeter({ value, threshold, label }: { value: number; threshold: number; label: string }) {
  return <ProgressBar value={value} threshold={threshold} label={label} />;
}
