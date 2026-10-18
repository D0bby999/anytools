/**
 * action-error.tsx
 * The API's own sentence when a loop action is refused — for a shut gate or
 * an unfinished review, the list of what is missing.
 */
export function ActionError({ result }: { result: unknown }) {
  if (!result || typeof result !== "object" || !("error" in result)) return null;
  const message = String((result as { error: unknown }).error ?? "");
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 text-sm leading-snug text-destructive">
      {message}
    </p>
  );
}
