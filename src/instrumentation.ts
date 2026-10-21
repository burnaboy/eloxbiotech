/**
 * Catches every unhandled server error (pages, server actions, route handlers) and logs it in the same
 * structured, scrubbed form as handled errors, with an alert if ERROR_ALERT_WEBHOOK is set.
 * Only the route and method are recorded: never headers, cookies or the request body.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logError } = await import("./lib/log");
  // Next.js reports redirects and not-found through the same path; they aren't errors.
  const digest = (err as { digest?: string })?.digest ?? "";
  if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND") return;
  logError(`${context.routeType} ${context.routePath}`, err, { method: request.method, path: request.path.split("?")[0], digest: digest || undefined });
}
