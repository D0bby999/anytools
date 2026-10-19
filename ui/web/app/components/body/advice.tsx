import { useTranslation } from "react-i18next";
import { num, type Prescription, type Unit } from "~/lib/body-types";

/**
 * Why this number: every target the progression engine set says so in a
 * sentence, because a suggestion nobody can audit is one nobody trusts.
 * Literal t() calls, so the i18n guard can see every key.
 */
export function AdviceText({ advice, unit }: { advice?: Prescription; unit: Unit }) {
  const { t } = useTranslation("body");
  if (!advice?.reason) return null;
  const v = {
    step: num(advice.step),
    unit,
    weight: num(advice.weight),
    reps: advice.reps ?? 0,
    sec: advice.sec ?? 0,
    stalls: advice.stalls ?? 0,
    left: advice.left ?? 0,
  };
  let text: string;
  switch (advice.reason) {
    case "first":
      text = t("advice.first");
      break;
    case "up":
      text = t("advice.up", v);
      break;
    case "hold":
      text = t("advice.hold", v);
      break;
    case "deload":
      text = t("advice.deload", v);
      break;
    case "range_up":
      text = t("advice.rangeUp", v);
      break;
    case "range_hold":
      text = t("advice.rangeHold", v);
      break;
    case "range_deload":
      text = t("advice.rangeDeload", v);
      break;
    case "bodyweight_up":
      text = t("advice.bodyweightUp", v);
      break;
    case "bodyweight_hold":
      text = t("advice.bodyweightHold");
      break;
    case "time_up":
      text = t("advice.timeUp", v);
      break;
    case "time_hold":
      text = t("advice.timeHold");
      break;
    case "time_deload":
      text = t("advice.timeDeload", v);
      break;
    default:
      return null;
  }
  return <p className="mt-1 text-sm leading-snug text-muted-foreground">{text}</p>;
}

/** A policy's name, for the plan editor and the coach's proposals. */
export function usePolicyName() {
  const { t } = useTranslation("body");
  return (p: string | undefined): string => {
    switch (p) {
      case "off":
        return t("policy.off");
      case "linear":
        return t("policy.linear");
      case "double":
        return t("policy.double");
      case "time":
        return t("policy.time");
      default:
        return t("policy.default");
    }
  };
}
