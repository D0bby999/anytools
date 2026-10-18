/**
 * auth-layout.tsx
 * Shell for the signed-out pages. Redirects an already-signed-in visitor away,
 * so /login never renders for someone who has a session.
 */
import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/auth-layout";
import { getUserId } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUserId(request)) throw redirect("/home");
  return null;
}

export default function AuthLayout() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 lg:px-8">
      <div className="w-full max-w-5xl">
        <Outlet />
      </div>
    </div>
  );
}
