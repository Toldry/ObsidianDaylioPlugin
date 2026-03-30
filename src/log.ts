/**
 * Shared debug logger.
 *
 * All output is tagged [daylio] so it can be filtered in devtools.
 * Routed through console.debug so it is hidden at the default log
 * level — enable "Verbose" in devtools to see it.
 */
const log = (...args: unknown[]): void =>
	console.debug("[daylio]", ...args);

export default log;
