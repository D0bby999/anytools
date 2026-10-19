/**
 * entry.client.tsx
 * React Router's client entry, with one addition: a study-app page in another
 * language (root.tsx marks it `data-app-lang`) imports that language before
 * hydrating, so the first client render matches the server's HTML.
 */
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { isSupportedLng, loadLanguage } from "~/lib/i18n";

async function hydrate() {
  const lang = document.documentElement.dataset.appLang ?? "";
  if (isSupportedLng(lang)) await loadLanguage(lang).catch(() => {});
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydratedRouter />
      </StrictMode>,
    );
  });
}

void hydrate();
