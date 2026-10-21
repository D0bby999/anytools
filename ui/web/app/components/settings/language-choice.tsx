import { useEffect, useState } from "react";
import { ChoiceRow } from "~/components/doc/choice-row";
import { supportedLngs, type SupportedLng } from "~/lib/i18n";

/** The native post still carries one language value, including before hydration. */
export function LanguageChoice({ language, label, names }: { language: SupportedLng; label: string; names: Record<SupportedLng, string> }) {
  const [value, setValue] = useState<string>(language);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready)
    return (
      <label>
        {label}
        <select name="language" defaultValue={language}>
          {supportedLngs.map((l) => (
            <option key={l} value={l} lang={l}>
              {names[l]}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <div className="w-full">
      <input type="hidden" name="language" value={value} />
      <ChoiceRow
        label={label}
        value={value}
        onChange={setValue}
        choices={supportedLngs.map((l) => ({ id: l, label: <span lang={l}>{names[l]}</span> }))}
      />
    </div>
  );
}
