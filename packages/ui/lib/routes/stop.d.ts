/**
 * The POST /local-infer/stop route: it renders the same plan the launch
 * rendered and runs the service's stop entry point, so the stop targets the
 * exact container or process the launch started (a re-adopted engine through
 * the record's pid). The stop then clears the target entry's launch record,
 * so a recycled pid cannot re-link an engine the user just stopped. A stop
 * that fails persists a note to the last-run logs and the log file and
 * answers 500, so the card's stop deadline settles the entry to the red Logs
 * state with the broken step named.
 * @module dsh-plugin-local-infer/ui/routes/stop
 */
import type { LocalInferService } from 'dsh-plugin-local-infer/service';
import type { LocalInferRoute } from '../route.ts';
/**
 * stopRoute builds the POST /local-infer/stop route definition the register
 * step holds by an effect.
 */
export declare function stopRoute(localInfer: LocalInferService): LocalInferRoute;
//# sourceMappingURL=stop.d.ts.map
