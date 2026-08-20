/**
 * Pure utility, math, and geometry helper functions.
 *
 * No DOM, no I/O, no Obsidian dependencies — safe for unit tests.
 */

/**
 * Gap between bar columns, in pixels. Shrinks at extreme zoom-out so
 * the gap doesn't dominate over the bars themselves.
 *
 * @param barWidth - Current bar width in pixels.
 * @returns Gap size: 2px at normal zoom, 1px at medium zoom, 0px at extreme zoom-out.
 */
export function barGapFor(barWidth: number): number {
	return barWidth >= 2 ? 2 : barWidth >= 1 ? 1 : 0;
}

/**
 * Format a Date object as an ISO "YYYY-MM-DD" string.
 *
 * @param date - The Date instance to format.
 * @returns Date string formatted as "YYYY-MM-DD".
 */
export function formatISODate(date: Date): string {
	const yyyy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

export interface StickyLabelParams {
	x1: number;
	x2: number;
	cardX: number;
	cardW: number;
	pillW: number;
	isCallout: boolean;
	visibleLeft: number;
	padding?: number;
}

export interface StickyLabelResult {
	x: number;
	width: number;
	isSticky: boolean;
}

/**
 * Computes sticky label position and width for range events when their start
 * date is scrolled out of frame to the left.
 */
export function computeStickyLabelPosition(
	params: StickyLabelParams,
): StickyLabelResult {
	const { x1, x2, cardX, cardW, pillW, isCallout, visibleLeft, padding = 8 } = params;

	if (visibleLeft > x1 && visibleLeft < x2 - padding) {
		const minWidth = isCallout ? cardW : Math.min(cardW, 40);
		const maxStickyX = x2 - minWidth;
		const stickyX = Math.max(x1, Math.min(visibleLeft + padding, maxStickyX));
		const width = isCallout ? cardW : Math.max(20, x2 - stickyX);

		return {
			x: Math.round(stickyX),
			width: Math.round(width),
			isSticky: true,
		};
	}

	return {
		x: Math.round(cardX),
		width: Math.round(isCallout ? cardW : pillW),
		isSticky: false,
	};
}
