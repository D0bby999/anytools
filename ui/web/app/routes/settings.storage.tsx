/**
 * settings.storage.tsx
 * Settings → Storage (drive-user-storage phase 2): keep the learner's own
 * files on AnyTools' server or in their Google Drive, see the space each
 * side holds, and move the files from before.
 *
 * Drive storage is opt-in (owner decision 2): connecting Drive never turns
 * it on. Choosing Drive needs a connection that works; the API makes the
 * "AnyTools" folder at that moment. Nothing on this page calls a model.
 */
import { useNavigation } from "react-router";
import type { Route } from "./+types/settings.storage";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { cancelMove, getStorage, setStorage, startMove } from "~/lib/storage.server";
import { storageErrorKey } from "~/lib/storage-types";
import { StoragePanel, type StorageActionData } from "~/components/storage/storage-panel";

export function meta() {
  return [{ title: "Storage · AnyLearn" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return { status: await getStorage(user.id) };
}

export async function action({ request }: Route.ActionArgs): Promise<StorageActionData> {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    switch (intent) {
      case "choose": {
        const storage = String(form.get("storage") ?? "");
        if (storage !== "server" && storage !== "drive") return { intent: "choose", errorKey: "errors.generic" };
        await setStorage(user.id, storage);
        return { intent: "choose", ok: true };
      }
      case "move": {
        const res = await startMove(user.id);
        return { intent: "move", ok: true, nothing: "nothing_to_move" in res && res.nothing_to_move === true };
      }
      case "cancel":
        await cancelMove(user.id);
        return { intent: "cancel", ok: true };
    }
  } catch (error) {
    if (error instanceof ApiError && (error.status === 409 || error.status === 502 || error.status === 404)) {
      return { intent: intent === "move" || intent === "cancel" ? intent : "choose", errorKey: storageErrorKey(error.code) };
    }
    throw error;
  }
  return { intent: "choose", errorKey: "errors.generic" };
}

export default function SettingsStorage({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  return <StoragePanel status={loaderData.status} pending={navigation.state !== "idle"} result={actionData} />;
}
