/**
 * app.api.drive.picker-token.ts
 * Resource route (action only): an access token for the Google Picker.
 *
 * The Picker is Google's widget and runs in the browser, so it needs the user's
 * token there (PickerBuilder.setOAuthToken). This route is how that token gets
 * to the page WITHOUT being in a loader: loader data is rendered into the HTML,
 * cached by the router and kept in history state, and a credential should be
 * none of those. It is fetched on the click that opens the Picker and held
 * only as long as the Picker is open.
 *
 * POST only, and answered no-store. What it returns is the ACCESS token — an
 * hour of drive.file, which can read nothing the user has not already picked —
 * and never the refresh token, which the API keeps encrypted.
 */
import type { Route } from "./+types/app.api.drive.picker-token";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { pickerToken } from "~/lib/drive.server";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const headers = { "Cache-Control": "no-store" };
  try {
    const { access_token } = await pickerToken(userId);
    return Response.json({ access_token }, { headers });
  } catch (error) {
    // The API's code is passed on so the page can say "reconnect" rather than
    // "something went wrong"; its message is not, because the page has copy.
    const status = error instanceof ApiError ? error.status : 502;
    const code = error instanceof ApiError ? (error.code ?? "failed") : "failed";
    return Response.json({ error: code }, { status: status >= 400 ? status : 502, headers });
  }
}
