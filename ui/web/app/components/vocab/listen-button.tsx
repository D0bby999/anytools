import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Volume2 } from "lucide-react";
import { plainText, speechSupported } from "~/lib/speech";
import { Button } from "~/components/ui/button";
import { ReadAloudBar } from "~/components/vocab/read-aloud";

/**
 * "Listen" under an answer: reads the answer's plain text — Markdown, citation
 * markers and LaTeX stripped — in the read-aloud panel. Rendered only once the
 * page is in a browser that has speechSynthesis, so the server render and a
 * browser without it show nothing.
 */
export function ListenButton({ text }: { text: string }) {
  const { t } = useTranslation("vocab");
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setSupported(speechSupported()), []);
  const spoken = plainText(text);
  if (!supported || !spoken) return null;
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="mt-1 h-8 px-2 text-xs" onClick={() => setOpen(true)}>
        <Volume2 aria-hidden="true" />
        {t("speech.listen")}
      </Button>
      {open ? <ReadAloudBar text={spoken} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
