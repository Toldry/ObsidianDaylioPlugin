/**
 * Pure scroll-position arithmetic for cursor-anchored zoom.
 *
 * The key invariant: the day column under the cursor stays at the same
 * viewport position after a zoom step.  When zooming out far enough that
 * the desired scroll position would be *negative* (the target day sits
 * right of where scrollLeft = 0 would place it), a CSS margin-left on the
 * SVG shifts content rightward, achieving the equivalent of negative scroll.
 *
 * No DOM, no I/O — safe to import in unit tests.
 */

import { LEFT_PAD, RIGHT_PAD } from "./graph-builder";
import { barGapFor } from "./types";

// ─── Types ─────────────────────────────────────────────────────────

export interface AnchorParams {
	/** SVG X coordinate of the point that should remain fixed. */
	svgX: number;
	/** Viewport X position where that point currently sits. */
	viewportX: number;
	/** Bar stride (width + gap) *before* the zoom change. */
	oldStride: number;
}

export interface ScrollResult {
	/** Horizontal scroll position (always ≥ 0). */
	scrollLeft: number;
	/** Left margin applied to the SVG element.  Non-zero only when the
	 *  raw scroll position would be negative. */
	marginLeft: number;
	/** Minimum SVG width that keeps the scrollbar functional (total
	 *  scrollable content = marginLeft + svgWidth > containerWidth). */
	svgWidth: number;
}

// ─── Core function ─────────────────────────────────────────────────

/**
 * Compute the scroll position, SVG left-margin, and minimum SVG width
 * needed to keep an anchor point at a fixed viewport position after a
 * zoom (stride) change.
 *
 * Invariant guaranteed:
 *   result.scrollLeft + anchor.viewportX − result.marginLeft === newSvgX
 * where newSvgX = LEFT_PAD + (anchor.svgX − LEFT_PAD) × (newStride / oldStride).
 */
export function computeAnchoredScroll(
	anchor: AnchorParams,
	newStride: number,
	intrinsicSvgWidth: number,
	containerWidth: number,
): ScrollResult {
	// Where the anchor point will sit in the new SVG coordinate space.
	const newSvgX =
		LEFT_PAD +
		(anchor.svgX - LEFT_PAD) * (newStride / anchor.oldStride);

	// The scroll position that would place newSvgX at viewportX.
	const rawScrollLeft = newSvgX - anchor.viewportX;

	// scrollLeft can't be negative; use a left margin to shift content
	// rightward by the deficit.
	const marginLeft = Math.max(0, -rawScrollLeft);
	const scrollLeft = Math.max(0, rawScrollLeft);

	// SVG must be wide enough that:
	//   1. it covers the visible viewport from the scroll position, and
	//   2. total scrollable content (margin + svgWidth) exceeds the
	//      container by at least 1 px so the scrollbar stays functional.
	const svgWidth = Math.max(
		intrinsicSvgWidth,
		scrollLeft + containerWidth - marginLeft,
		containerWidth + 1 - marginLeft,
	);

	return { scrollLeft, marginLeft, svgWidth };
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * The natural (intrinsic) SVG width for a given day count and bar width.
 * Mirrors the `graphWidth` formula in graph-builder.ts.
 */
export function computeIntrinsicWidth(
	dayCount: number,
	barWidth: number,
): number {
	const gap = barGapFor(barWidth);
	const stride = barWidth + gap;
	return dayCount * stride - gap + LEFT_PAD + RIGHT_PAD;
}
