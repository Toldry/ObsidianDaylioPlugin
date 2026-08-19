/**
 * Shared logger utility for Daylio plugin.
 *
 * All output is tagged [daylio] so it can be filtered in devtools.
 * - debug: Routed through console.debug (visible when "Verbose" level is enabled).
 * - info:  Routed through console.info.
 * - warn:  Routed through console.warn.
 * - error: Routed through console.error.
 */
export const logDebug = (...args: unknown[]): void =>
	console.debug("[daylio]", ...args);

export const logInfo = (...args: unknown[]): void =>
	console.info("[daylio]", ...args);

export const logWarn = (...args: unknown[]): void =>
	console.warn("[daylio]", ...args);

export const logError = (...args: unknown[]): void =>
	console.error("[daylio]", ...args);

export const log = {
	debug: logDebug,
	info: logInfo,
	warn: logWarn,
	error: logError,
};

export default log;
