/**
 * settings.reminders.tsx
 * Settings → Reminders: install AnyLearn on this device, and the daily review
 * reminder, a web push at the learner's own hour (internal/push).
 *
 * The hour and the test are form posts, so they work before hydration.
 * Turning reminders on cannot be: the browser makes the subscription, so the
 * panel asks for it and posts the result here.
 */
import { useNavigation } from "react-router";
import type { Route } from "./+types/settings.reminders";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { getPush, parseSubscription, setReminderHour, subscribePush, testPush, unsubscribePush } from "~/lib/push.server";
import { RemindersPanel, type RemindersActionData } from "~/components/reminders/reminders-panel";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Reminders") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return { push: await getPush(user.id) };
}

export async function action({ request }: Route.ActionArgs): Promise<RemindersActionData> {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    switch (intent) {
      case "hour": {
        const hour = Number(form.get("hour"));
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { intent, errorKey: "reminders.errors.generic" };
        await setReminderHour(user.id, hour);
        return { intent, ok: true };
      }
      case "subscribe": {
        const subscription = parseSubscription(form.get("subscription"));
        if (!subscription) return { intent, errorKey: "reminders.errors.subscribe" };
        await subscribePush(user.id, subscription);
        return { intent, ok: true };
      }
      case "unsubscribe": {
        const endpoint = String(form.get("endpoint") ?? "");
        if (endpoint) await unsubscribePush(user.id, endpoint);
        return { intent, ok: true };
      }
      case "test": {
        const { sent } = await testPush(user.id);
        return { intent, ok: true, sent };
      }
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { intent, errorKey: intent === "subscribe" ? "reminders.errors.subscribe" : "reminders.errors.generic" };
    }
    throw error;
  }
  return { intent, errorKey: "reminders.errors.generic" };
}

export default function SettingsReminders({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  return <RemindersPanel push={loaderData.push} pending={navigation.state !== "idle"} result={actionData} />;
}
