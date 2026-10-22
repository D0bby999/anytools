/**
 * "Explain in": the language a path's plan, lessons and feedback are written
 * in (the private design notes, phase 4). The learner's own language
 * first, then the documents' own, then the languages they study.
 */
import { useTranslation } from "react-i18next";
import { languageName } from "~/lib/languages";

export function ExplainLangSelect({
  id,
  name = "explain_lang",
  value,
  studied = [],
  onChange,
  className,
}: {
  id: string;
  name?: string;
  value?: string;
  studied?: readonly string[];
  onChange?: (value: string) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation("study");
  const ui = (i18n.language || "en").slice(0, 2);
  const others = [...new Set(studied.filter((code) => code !== ui))];
  // A code chosen before that is no longer studied stays offered.
  if (value && value !== "source" && value !== ui && !others.includes(value)) others.push(value);
  return (
    <select
      id={id}
      name={name}
      {...(onChange ? { value: value ?? "", onChange: (e) => onChange(e.target.value) } : { defaultValue: value ?? "" })}
      className={className ?? "mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"}
    >
      <option value="">{t("explainLang.mine", { language: languageName(ui, i18n.language) })}</option>
      <option value="source">{t("explainLang.source")}</option>
      {others.map((code) => (
        <option key={code} value={code}>
          {languageName(code, i18n.language)}
        </option>
      ))}
    </select>
  );
}
