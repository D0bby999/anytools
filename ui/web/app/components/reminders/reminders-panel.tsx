/**
 * reminders-panel.tsx
 * Settings → Reminders: install AnyLearn on this device, and turn the daily
 * review reminder on or off in this browser, at the learner's hour.
 *
 * What the browser can do decides what is offered. iPhone and iPad receive a
 * push only once AnyLearn is on the Home Screen, so there the first thing
 * shown is how to put it there; Chromium offers an install prompt, held by
 * lib/pwa.ts until the learner asks.
 */
import { Field } from "~/components/doc/field";
import { Switch } from "~/components/doc/switch";
import { Details } from "~/components/doc/details";
import { useEffect, useState } from "react";
import { Form, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { applicationServerKey, clearInstallPrompt, isIOS, isStandalone, pendingInstallPrompt, pushSupported } from "~/lib/pwa";

export type RemindersActionData = {
  intent: string;
  ok?: boolean;
  sent?: number;
  errorKey?: string;
};

type Push = { public_key: string; hour: number; timezone: string; endpoints: string[] };

/** What this browser is, read after hydration (the server cannot know). */
type Device = {
  ready: boolean;
  ios: boolean;
  standalone: boolean;
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  endpoint: string | null;
};

const UNKNOWN: Device = { ready: false, ios: false, standalone: false, supported: false, permission: "unsupported", endpoint: null };

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function useDevice(): [Device, (d: Partial<Device>) => void] {
  const [device, setDevice] = useState<Device>(UNKNOWN);
  useEffect(() => {
    const supported = pushSupported();
    const base: Device = {
      ready: true,
      ios: isIOS(),
      standalone: isStandalone(),
      supported,
      permission: supported ? Notification.permission : "unsupported",
      endpoint: null,
    };
    setDevice(base);
    if (!supported) return;
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setDevice({ ...base, endpoint: sub?.endpoint ?? null }))
      .catch(() => {});
  }, []);
  return [device, (d) => setDevice((prev) => ({ ...prev, ...d }))];
}

export function RemindersPanel({ push, pending, result }: { push: Push; pending: boolean; result?: RemindersActionData }) {
  const { t } = useTranslation("common");
  const [device, update] = useDevice();
  const fetcher = useFetcher<RemindersActionData>();
  const [busy, setBusy] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);

  useEffect(() => setCanPrompt(pendingInstallPrompt() !== null), []);

  const onHere = device.endpoint !== null && push.endpoints.includes(device.endpoint);
  const working = busy || fetcher.state !== "idle";

  async function turnOn() {
    setClientError(null);
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      update({ permission });
      if (permission !== "granted") return;
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(push.public_key) }));
      update({ endpoint: sub.endpoint });
      void fetcher.submit({ intent: "subscribe", subscription: JSON.stringify(sub.toJSON()) }, { method: "post" });
    } catch {
      setClientError("reminders.errors.subscribe");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setClientError(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub?.endpoint ?? device.endpoint;
      await sub?.unsubscribe();
      update({ endpoint: null });
      if (endpoint) void fetcher.submit({ intent: "unsubscribe", endpoint }, { method: "post" });
    } catch {
      setClientError("reminders.errors.generic");
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    const prompt = pendingInstallPrompt();
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    clearInstallPrompt();
    setCanPrompt(false);
    if (outcome === "accepted") update({ standalone: true });
  }

  const fetchError = fetcher.data?.errorKey ?? null;
  const hourError = result?.intent === "hour" ? result.errorKey : undefined;
  const testError = result?.intent === "test" ? result.errorKey : undefined;

  return (
    <div className="mt-8 space-y-10">
      <section aria-labelledby="lp-reminders-push">
        <h2 id="lp-reminders-push" className="lp-section">
          {t("reminders.push.title")}
        </h2>
        <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{t("reminders.push.lead")}</p>

        <div className="mt-4 space-y-3">
          {!device.ready ? null : !device.supported ? (
            <p className="max-w-(--lp-measure-read) text-sm leading-snug">
              {device.ios && !device.standalone ? t("reminders.push.iosFirst") : t("reminders.push.unsupported")}
            </p>
          ) : device.permission === "denied" ? (
            <p role="alert" className="max-w-(--lp-measure-read) text-sm leading-snug text-destructive">
              {t("reminders.push.blocked")}
            </p>
          ) : onHere ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-sm leading-snug">
                {t("reminders.push.onHere")}
              </p>
              <Switch checked onCheckedChange={() => void turnOff()} disabled={working} label={t("reminders.push.turnOff")} />
            </div>
          ) : (
            <Switch
              checked={false}
              onCheckedChange={() => void turnOn()}
              disabled={working || !push.public_key}
              label={t("reminders.push.turnOn")}
            />
          )}

          {push.endpoints.length > 0 ? (
            <p className="text-sm leading-snug text-muted-foreground">{t("reminders.push.browsers", { count: push.endpoints.length })}</p>
          ) : null}
          {clientError || fetchError ? (
            <p role="alert" className="text-sm leading-snug text-destructive">
              {t(clientError ?? fetchError ?? "reminders.errors.generic")}
            </p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="lp-reminders-hour">
        <h2 id="lp-reminders-hour" className="lp-section">
          {t("reminders.hour.title")}
        </h2>
        <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="hour" />
          <Field label={t("reminders.hour.label")}>
            <select
              name="hour"
              defaultValue={push.hour}
              className="min-h-11 min-w-32 rounded-md border border-control-border bg-card px-3 font-mono text-sm tabular-nums"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="outline" disabled={pending}>
            {t("reminders.hour.save")}
          </Button>
        </Form>
        <p className="mt-2 text-sm leading-snug text-muted-foreground">{t("reminders.hour.zone", { zone: push.timezone })}</p>
        {result?.intent === "hour" && result.ok ? (
          <p role="status" className="mt-2 text-sm leading-snug">
            {t("reminders.hour.saved")}
          </p>
        ) : null}
        {hourError ? (
          <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
            {t(hourError)}
          </p>
        ) : null}

        {push.endpoints.length > 0 ? (
          <Form method="post" className="mt-6">
            <input type="hidden" name="intent" value="test" />
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              {t("reminders.test.button")}
            </Button>
          </Form>
        ) : null}
        {result?.intent === "test" && result.ok ? (
          <p role="status" className="mt-2 text-sm leading-snug">
            {t("reminders.test.sent", { count: result.sent ?? 0 })}
          </p>
        ) : null}
        {testError ? (
          <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
            {t(testError)}
          </p>
        ) : null}
      </section>
      <Details summary={t("reminders.install.title")}>
        <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{t("reminders.install.lead")}</p>
        {!device.ready ? null : device.standalone ? (
          <p role="status" className="mt-3 text-sm leading-snug">
            {t("reminders.install.installed")}
          </p>
        ) : device.ios ? (
          <ol className="lp-steps mt-4 max-w-(--lp-measure-read) space-y-2 text-sm leading-snug">
            <li>{t("reminders.install.ios.safari")}</li>
            <li>{t("reminders.install.ios.share")}</li>
            <li>{t("reminders.install.ios.add")}</li>
            <li>{t("reminders.install.ios.open")}</li>
          </ol>
        ) : canPrompt ? (
          <div className="mt-4">
            <Button type="button" onClick={() => void install()}>
              {t("reminders.install.button")}
            </Button>
          </div>
        ) : (
          <ol className="lp-steps space-y-1">
            <li>{t("reminders.install.browser")}</li>
          </ol>
        )}
      </Details>
    </div>
  );
}
