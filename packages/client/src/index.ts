/**
 * The browser card entry: the lazy-CJS factory exports.
 *
 * apply wires the card into the host (see ./plugin.ts). inject is empty
 * because `slots` and `locale` are both optional (registerCard takes each on
 * its own scoped inject), so the plugin loads in every profile.
 * @module dsh-plugin-local-infer/client
 */

export { apply } from './plugin.ts'
export const inject: string[] = []
