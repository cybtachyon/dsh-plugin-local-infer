// Host carrier for the dsh-plugin-local-infer client half.
//
// The bare package has no host logic of its own; its four host entries are the
// /service, /providers, /tool, and /ui subpaths. This no-op module exists so
// the Loader mounts the bare package name, which is what the client-module
// scan keys the `dsh.client` declaration on. Without it the browser card in
// dsh/client.js is never added to the boot graph, because the scan only maps
// a bare package-root entry to its `dsh.client` field, never a subpath.
export const name = 'local-infer'
export const inject = []
export function apply(ctx) {
  void ctx
}
const plugin = { name, inject, apply }
export default plugin
