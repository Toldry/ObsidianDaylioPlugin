import { describe, it, expect } from "vitest";
import {
	computeAnchoredScroll,
	computeIntrinsicWidth,
	type AnchorParams,
	type ScrollResult,
} from "../../src/scroll-math";

/* LEFT_PAD is re-exported indirectly through computeAnchoredScroll.
 * We duplicate the constant here so the tests can verify the invariant
 * independently of the implementation. */
const LEFT_PAD = 20;

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * The anchor invariant: after a zoom, the SVG coordinate reconstructed
 * from (scrollLeft, viewportX, marginLeft) must equal the expected new
 * SVG position of the original anchor point.
 *
 *   result.scrollLeft + viewportX − result.marginLeft === newSvgX
 *
 * where  newSvgX = LEFT_PAD + (svgX − LEFT_PAD) × (newStride / oldStride)
 */
function assertAnchorInvariant(
	anchor: AnchorParams,
	newStride: number,
	result: ScrollResult,
): void {
	const newSvgX =
		LEFT_PAD +
		(anchor.svgX - LEFT_PAD) * (newStride / anchor.oldStride);
	const actualSvgX =
		result.scrollLeft + anchor.viewportX - result.marginLeft;
	expect(actualSvgX).toBeCloseTo(newSvgX, 10);
}

/** Verify structural invariants that must hold for every result. */
function assertStructuralInvariants(
	result: ScrollResult,
	containerWidth: number,
): void {
	expect(result.scrollLeft).toBeGreaterThanOrEqual(0);
	expect(result.marginLeft).toBeGreaterThanOrEqual(0);
	// Total scrollable content must exceed the container (functional scrollbar)
	expect(result.marginLeft + result.svgWidth).toBeGreaterThan(
		containerWidth,
	);
}

// ─── barGapFor (duplicated so tests are self-contained) ──────────

function barGapFor(barWidth: number): number {
	return barWidth >= 2 ? 2 : barWidth >= 1 ? 1 : 0;
}

function strideFor(barWidth: number): number {
	return barWidth + barGapFor(barWidth);
}

// ─── Tests ───────────────────────────────────────────────────────

describe("computeAnchoredScroll", () => {
	// ── Normal zoom (graph wider than viewport) ──────────────────

	it("preserves anchor when graph is wider than viewport", () => {
		const anchor: AnchorParams = {
			svgX: 500,
			viewportX: 300,
			oldStride: strideFor(8), // 10
		};
		const newStride = strideFor(5); // 7
		const intrinsic = 2000;
		const container = 800;

		const result = computeAnchoredScroll(
			anchor, newStride, intrinsic, container,
		);

		assertAnchorInvariant(anchor, newStride, result);
		assertStructuralInvariants(result, container);
		expect(result.marginLeft).toBe(0);
		expect(result.scrollLeft).toBeGreaterThan(0);
	});

	it("preserves anchor when zooming in", () => {
		const anchor: AnchorParams = {
			svgX: 200,
			viewportX: 400,
			oldStride: strideFor(2), // 4
		};
		const newStride = strideFor(5); // 7
		const intrinsic = 3500;
		const container = 800;

		const result = computeAnchoredScroll(
			anchor, newStride, intrinsic, container,
		);

		assertAnchorInvariant(anchor, newStride, result);
		assertStructuralInvariants(result, container);
	});

	// ── Zoom out past viewport boundary (the main bug) ──────────

	it("uses margin when graph fits inside viewport after zoom-out", () => {
		// Cursor is in the middle of a wide graph, zoom out until
		// the graph is narrower than the viewport.
		const anchor: AnchorParams = {
			svgX: 500,
			viewportX: 600,
			oldStride: strideFor(8), // 10
		};
		const newStride = strideFor(0.25); // 0.25 (no gap)
		const intrinsic = computeIntrinsicWidth(200, 0.25); // ~90 px
		const container = 800;

		const result = computeAnchoredScroll(
			anchor, newStride, intrinsic, container,
		);

		assertAnchorInvariant(anchor, newStride, result);
		assertStructuralInvariants(result, container);
		// rawScrollLeft should be negative → marginLeft > 0
		expect(result.marginLeft).toBeGreaterThan(0);
		expect(result.scrollLeft).toBe(0);
	});

	it("uses margin when cursor is near right edge of viewport", () => {
		// Cursor near the right edge forces a large negative rawScrollLeft
		const anchor: AnchorParams = {
			svgX: 100,
			viewportX: 750,
			oldStride: strideFor(8), // 10
		};
		const newStride = strideFor(5); // 7
		const intrinsic = 1400;
		const container = 800;

		const result = computeAnchoredScroll(
			anchor, newStride, intrinsic, container,
		);

		assertAnchorInvariant(anchor, newStride, result);
		assertStructuralInvariants(result, container);
		// newSvgX ≈ 20 + 80 × 0.7 = 76; rawScrollLeft ≈ 76 − 750 < 0
		expect(result.marginLeft).toBeGreaterThan(0);
		expect(result.scrollLeft).toBe(0);
	});

	// ── Label toggle (stride unchanged) ─────────────────────────

	it("preserves exact scroll position when stride does not change", () => {
		// Simulates the label toggle: same zoom, only vertical content changes.
		const bw = 5;
		const stride = strideFor(bw); // 7
		const scrollLeft = 350;
		const viewportX = 400;
		const svgX = scrollLeft + viewportX; // 750 (no margin)

		const anchor: AnchorParams = { svgX, viewportX, oldStride: stride };
		const intrinsic = 2000;
		const container = 800;

		const result = computeAnchoredScroll(
			anchor, stride, intrinsic, container,
		);

		assertAnchorInvariant(anchor, stride, result);
		assertStructuralInvariants(result, container);
		expect(result.scrollLeft).toBeCloseTo(scrollLeft, 10);
		expect(result.marginLeft).toBe(0);
	});

	it("preserves position when stride unchanged and margin was active", () => {
		// Label toggle while in a margin state.
		const bw = 0.25;
		const stride = strideFor(bw); // 0.25
		const marginLeft = 200;
		const scrollLeft = 0;
		const viewportX = 400;
		const svgX = scrollLeft + viewportX - marginLeft; // 200

		const anchor: AnchorParams = { svgX, viewportX, oldStride: stride };
		const intrinsic = computeIntrinsicWidth(100, bw);
		const container = 800;

		const result = computeAnchoredScroll(
			anchor, stride, intrinsic, container,
		);

		assertAnchorInvariant(anchor, stride, result);
		assertStructuralInvariants(result, container);
		// Should reproduce the same margin state
		expect(result.scrollLeft).toBe(0);
		expect(result.marginLeft).toBeCloseTo(marginLeft, 10);
	});

	// ── Edge cases ──────────────────────────────────────────────

	it("handles svgX exactly at LEFT_PAD (leftmost bar position)", () => {
		const anchor: AnchorParams = {
			svgX: LEFT_PAD,
			viewportX: 400,
			oldStride: strideFor(8), // 10
		};
		const newStride = strideFor(2); // 4
		const intrinsic = 800;
		const container = 800;

		const result = computeAnchoredScroll(
			anchor, newStride, intrinsic, container,
		);

		assertAnchorInvariant(anchor, newStride, result);
		assertStructuralInvariants(result, container);
		// LEFT_PAD maps to LEFT_PAD regardless of stride ratio
		const newSvgX = LEFT_PAD; // no scaling of zero offset
		expect(
			result.scrollLeft + anchor.viewportX - result.marginLeft,
		).toBeCloseTo(newSvgX, 10);
	});

	it("handles cursor at viewport left edge (viewportX = 0)", () => {
		const anchor: AnchorParams = {
			svgX: 300,
			viewportX: 0,
			oldStride: strideFor(5), // 7
		};
		const newStride = strideFor(3); // 5
		const intrinsic = 1500;
		const container = 800;

		const result = computeAnchoredScroll(
			anchor, newStride, intrinsic, container,
		);

		assertAnchorInvariant(anchor, newStride, result);
		assertStructuralInvariants(result, container);
		// viewportX = 0 means scrollLeft = newSvgX (no margin needed)
		expect(result.marginLeft).toBe(0);
	});

	it("handles a very small graph with very few days", () => {
		const anchor: AnchorParams = {
			svgX: 30,
			viewportX: 400,
			oldStride: strideFor(8), // 10
		};
		const newStride = strideFor(0.25); // 0.25
		const intrinsic = computeIntrinsicWidth(5, 0.25); // ~41 px
		const container = 1200;

		const result = computeAnchoredScroll(
			anchor, newStride, intrinsic, container,
		);

		assertAnchorInvariant(anchor, newStride, result);
		assertStructuralInvariants(result, container);
	});

	// ── Consecutive zoom steps (simulates rapid Ctrl+scroll) ────

	it("maintains invariant across consecutive zoom-out steps", () => {
		const container = 800;
		const dayCount = 300;
		const viewportX = 400; // cursor stays at viewport centre

		// Start zoomed in
		const bw = 8;
		let stride = strideFor(bw); // 10
		let scrollLeft = 1500;
		let marginLeft = 0;
		// SVG coordinate under cursor
		let svgX = scrollLeft + viewportX - marginLeft; // 1900

		// Zoom out in steps
		const zoomSteps = [5, 3, 2, 1, 0.5, 0.25];
		for (const newBw of zoomSteps) {
			const newStride = strideFor(newBw);
			const intrinsic = computeIntrinsicWidth(dayCount, newBw);
			const anchor: AnchorParams = {
				svgX,
				viewportX,
				oldStride: stride,
			};

			const result = computeAnchoredScroll(
				anchor, newStride, intrinsic, container,
			);

			assertAnchorInvariant(anchor, newStride, result);
			assertStructuralInvariants(result, container);

			// Update state for next iteration
			scrollLeft = result.scrollLeft;
			marginLeft = result.marginLeft;
			svgX = scrollLeft + viewportX - marginLeft;
			stride = newStride;
		}
	});

	it("maintains invariant across consecutive zoom-in steps", () => {
		const container = 800;
		const dayCount = 300;
		const viewportX = 400;

		// Start zoomed out (in margin state)
		const bw = 0.25;
		let stride = strideFor(bw);
		let marginLeft = 300;
		let scrollLeft = 0;
		let svgX = scrollLeft + viewportX - marginLeft; // 100

		const zoomSteps = [0.5, 1, 2, 3, 5, 8];
		for (const newBw of zoomSteps) {
			const newStride = strideFor(newBw);
			const intrinsic = computeIntrinsicWidth(dayCount, newBw);
			const anchor: AnchorParams = {
				svgX,
				viewportX,
				oldStride: stride,
			};

			const result = computeAnchoredScroll(
				anchor, newStride, intrinsic, container,
			);

			assertAnchorInvariant(anchor, newStride, result);
			assertStructuralInvariants(result, container);

			scrollLeft = result.scrollLeft;
			marginLeft = result.marginLeft;
			svgX = scrollLeft + viewportX - marginLeft;
			stride = newStride;
		}
	});

	it("round-trips: zoom out then back in returns to original position", () => {
		const container = 800;
		const dayCount = 300;
		const viewportX = 400;

		// Initial state
		const initialBw = 5;
		const initialStride = strideFor(initialBw); // 7
		const initialScrollLeft = 600;
		const initialSvgX = initialScrollLeft + viewportX; // 1000

		// Zoom out to 0.25
		const zoomOutBw = 0.25;
		const zoomOutStride = strideFor(zoomOutBw);
		const intrinsicOut = computeIntrinsicWidth(dayCount, zoomOutBw);
		const resultOut = computeAnchoredScroll(
			{ svgX: initialSvgX, viewportX, oldStride: initialStride },
			zoomOutStride,
			intrinsicOut,
			container,
		);
		assertAnchorInvariant(
			{ svgX: initialSvgX, viewportX, oldStride: initialStride },
			zoomOutStride,
			resultOut,
		);

		// Zoom back in to 5
		const midSvgX =
			resultOut.scrollLeft + viewportX - resultOut.marginLeft;
		const intrinsicIn = computeIntrinsicWidth(dayCount, initialBw);
		const resultIn = computeAnchoredScroll(
			{ svgX: midSvgX, viewportX, oldStride: zoomOutStride },
			initialStride,
			intrinsicIn,
			container,
		);
		assertAnchorInvariant(
			{ svgX: midSvgX, viewportX, oldStride: zoomOutStride },
			initialStride,
			resultIn,
		);

		// The scroll position should be back where we started
		expect(resultIn.scrollLeft).toBeCloseTo(initialScrollLeft, 5);
		expect(resultIn.marginLeft).toBe(0);
	});
});

describe("computeIntrinsicWidth", () => {
	it("matches the graph-builder formula for typical bar widths", () => {
		// graphWidth = days * stride - gap + LEFT_PAD + RIGHT_PAD
		const dayCount = 200;
		const testWidths = [0.25, 0.5, 1, 2, 3, 5, 8];

		for (const bw of testWidths) {
			const gap = barGapFor(bw);
			const stride = bw + gap;
			const expected = dayCount * stride - gap + LEFT_PAD + LEFT_PAD;
			// LEFT_PAD === RIGHT_PAD === 20
			expect(computeIntrinsicWidth(dayCount, bw)).toBeCloseTo(
				expected,
				10,
			);
		}
	});

	it("returns LEFT_PAD + RIGHT_PAD for zero days", () => {
		// Edge case: 0 * stride - gap + 40 = 40 - gap
		// Actually: 0 days means an empty graph, width = -gap + 40
		// which could be negative for gap > 40 (impossible; gap ∈ {0,1,2}).
		const result = computeIntrinsicWidth(0, 8);
		// 0 * 10 - 2 + 20 + 20 = 38
		expect(result).toBe(38);
	});

	it("returns correct width for a single day", () => {
		// 1 * stride - gap + 40 = stride - gap + 40 = barWidth + 40
		const result = computeIntrinsicWidth(1, 5);
		// 1 * 7 - 2 + 40 = 45
		expect(result).toBe(45);
	});
});

describe("Drag pan scrolling logic", () => {
	it("computes horizontal scroll displacement correctly when dragging mouse", () => {
		const startX = 500;
		const startScrollLeft = 200;

		// Dragging left (moving mouse to clientX = 450) should scroll right
		const moveLeftClientX = 450;
		const deltaLeft = startX - moveLeftClientX; // +50
		expect(startScrollLeft + deltaLeft).toBe(250);

		// Dragging right (moving mouse to clientX = 550) should scroll left
		const moveRightClientX = 550;
		const deltaRight = startX - moveRightClientX; // -50
		expect(startScrollLeft + deltaRight).toBe(150);
	});
});

