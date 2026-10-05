/**
 * Validation for a sandboxed worker's `webhook-subscribe` messages, mirroring the loader's
 * onHookSubscribe hardening. The IPC boundary is untrusted: a hostile/buggy worker can post
 * `webhook-subscribe` with an undeclared route, or a flood of fabricated ones.
 *
 * The claim is only checked and logged, never recorded: dispatch goes to whatever manifest-declared
 * route the ingress layer resolved, and the worker answers 404 for a route it never registered. Keyed
 * off the manifest (which the operator authored, not the worker): drop when the manifest lacks
 * `webhook:ingress` (silent, since the plugin has no ingress at all), and drop an undeclared route with
 * at most one warning, so a flood isn't a log-flood vector.
 */
export interface OnWebhookSubscribeDeps {
  pluginId: string;
  declaredRoutes: Set<string>; // routes from manifest.ingress[].route
  hasPermission: boolean; // manifest declares webhook:ingress
  warn: (message: string, meta: Record<string, unknown>) => void;
}

export function makeOnWebhookSubscribe(deps: OnWebhookSubscribeDeps): (route: string) => void {
  let unknownRouteWarned = false;
  return (route: string): void => {
    if (!deps.hasPermission) return; // no ingress permission => the plugin claims no routes at all
    if (deps.declaredRoutes.has(route) || unknownRouteWarned) return;
    unknownRouteWarned = true; // warn at most once per plugin so a flood isn't a log-flood vector
    deps.warn(`Sandboxed plugin ${deps.pluginId} subscribed to an undeclared ingress route; ignoring`, {
      pluginId: deps.pluginId,
      route,
      action: 'sandbox_unknown_ingress_route',
    });
  };
}
