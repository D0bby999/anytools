/**
 * card-picture.tsx
 * A deck card's picture (a flag, a map) and its credit. The picture is a
 * file AnyLearn stages under /tool-runtime/ (the API refuses anything else);
 * the credit names its source page and licence, as their licences ask. Its
 * alt text does not describe it: the picture is the question.
 */
import { useTranslation } from "react-i18next";
import type { CardImage } from "~/lib/vocab-types";

/** Creative Commons licences by the short name sources give them. */
const LICENCE_URLS: Record<string, string> = {
  "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
  "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC BY-SA 1.0": "https://creativecommons.org/licenses/by-sa/1.0/",
  "CC BY-SA 2.5": "https://creativecommons.org/licenses/by-sa/2.5/",
  "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "CC0 1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
};

export function CardPicture({ image }: { image: CardImage }) {
  const { t } = useTranslation("vocab");
  return (
    <img
      src={`/tool-runtime/${image.src}`}
      alt={t("decks.picture.alt")}
      className="mt-3 h-44 w-auto max-w-full rounded-md border bg-card object-contain"
      decoding="async"
    />
  );
}

export function PictureCredit({ image }: { image: CardImage }) {
  const { t } = useTranslation("vocab");
  let host = image.source;
  try {
    host = new URL(image.source).hostname.replace(/^www\./, "");
  } catch {
    // shown as given
  }
  const licence = image.licence === "PD" ? t("decks.picture.publicDomain") : image.licence;
  const url = LICENCE_URLS[image.licence];
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {t("decks.picture.credit")}{" "}
      <a href={image.source} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
        {host}
      </a>
      {" · "}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer license" className="text-primary underline underline-offset-4">
          {licence}
        </a>
      ) : (
        licence
      )}
    </p>
  );
}
