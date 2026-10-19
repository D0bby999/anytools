import { useTranslation } from "react-i18next";

/**
 * A muscle group's name (internal/body MuscleGroups). Literal t() calls, so
 * the i18n guard can see every key.
 */
export function useMuscleName() {
  const { t } = useTranslation("body");
  return (group: string): string => {
    switch (group) {
      case "shoulders":
        return t("muscle.shoulders");
      case "chest":
        return t("muscle.chest");
      case "back":
        return t("muscle.back");
      case "biceps":
        return t("muscle.biceps");
      case "triceps":
        return t("muscle.triceps");
      case "forearms":
        return t("muscle.forearms");
      case "core":
        return t("muscle.core");
      case "lower_back":
        return t("muscle.lowerBack");
      case "glutes":
        return t("muscle.glutes");
      case "hips":
        return t("muscle.hips");
      case "quads":
        return t("muscle.quads");
      case "hamstrings":
        return t("muscle.hamstrings");
      case "calves":
        return t("muscle.calves");
    }
    return group;
  };
}

/**
 * A library word (a body part, a piece of equipment, a muscle) in the learner's
 * language. The dataset names them in English; `terms` in body.json holds the
 * fixed set, and a word it lacks shows as the library wrote it.
 */
export function useLibraryTerm() {
  const { t } = useTranslation("body");
  const terms = t("terms", { returnObjects: true }) as Record<string, string>;
  return (word: string): string => terms[word] ?? word;
}
