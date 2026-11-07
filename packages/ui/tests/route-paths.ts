/**
 * The expected route table: the one list of paths and methods
 * registerLocalInferRoute serves. The route and bootstrap test files derive
 * the registered path order, the route count, and each route's wrong-method
 * complement from here, so adding a route edits this list in one place.
 * @module dsh-plugin-local-infer/ui/tests/route-paths
 */

/**
 * EXPECTED_ROUTES lists the routes in registration order, each with the one
 * method it answers (every other method reads as a 405).
 */
export const EXPECTED_ROUTES: ReadonlyArray<{ path: string; method: 'GET' | 'POST' }> = [
  { path: '/local-infer/summary', method: 'GET' },
  { path: '/local-infer/save', method: 'POST' },
  { path: '/local-infer/provider-delete', method: 'POST' },
  { path: '/local-infer/deps', method: 'GET' },
  { path: '/local-infer/install', method: 'POST' },
  { path: '/local-infer/download', method: 'POST' },
  { path: '/local-infer/chat-template', method: 'POST' },
  { path: '/local-infer/get', method: 'POST' },
  { path: '/local-infer/launch', method: 'POST' },
  { path: '/local-infer/stop', method: 'POST' },
  { path: '/local-infer/logs', method: 'GET' },
  { path: '/local-infer/register', method: 'POST' },
  { path: '/local-infer/unregister', method: 'POST' },
]

/**
 * EXPECTED_ROUTE_PATHS derives the registered path list, in order, from the
 * route table.
 */
export const EXPECTED_ROUTE_PATHS: string[] = EXPECTED_ROUTES.map((route) => route.path)

/**
 * wrongMethodFor returns the HTTP method the named route rejects: the
 * wrong-method request a 405 test sends.
 */
export function wrongMethodFor(path: string): 'GET' | 'POST' {
  const route = EXPECTED_ROUTES.find((entry) => entry.path === path)
  return route?.method === 'GET' ? 'POST' : 'GET'
}
