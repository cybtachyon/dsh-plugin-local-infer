/**
 * The model-facing tools for the local-inference capability:
 * `local_infer_estimate`, `local_infer_launch`, `local_infer_status`, and
 * `local_infer_register`, each registered with its own timeout budget (launch
 * is long, estimate is fast), plus the system-prompt section that tells the
 * agent when to reach for them.
 *
 * In the scaffold this plugin is a no-op placeholder that injects the seam so
 * the bundle loads with zero tools. Phase 8 registers the four tools and the
 * prompt section.
 * @module @dsh/dsh-plugin-local-infer/tool
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "local-infer-tool";
export declare const inject: string[];
/**
 * Mount the model-facing tools. The scaffold registers nothing so the bundle
 * stays loadable; the tool registrations land in Phase 8.
 */
export declare function apply(ctx: Context): void;
declare const plugin: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default plugin;
//# sourceMappingURL=index.d.ts.map