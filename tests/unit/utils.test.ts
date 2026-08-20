import { describe, it, expect } from "vitest";
import { barGapFor, formatISODate } from "../../src/utils";

describe("barGapFor", () => {
	it("returns 2 for barWidth >= 2", () => {
		expect(barGapFor(2)).toBe(2);
		expect(barGapFor(4)).toBe(2);
		expect(barGapFor(8)).toBe(2);
	});

	it("returns 1 for 1 <= barWidth < 2", () => {
		expect(barGapFor(1)).toBe(1);
		expect(barGapFor(1.5)).toBe(1);
		expect(barGapFor(1.99)).toBe(1);
	});

	it("returns 0 for barWidth < 1", () => {
		expect(barGapFor(0.25)).toBe(0);
		expect(barGapFor(0.5)).toBe(0);
		expect(barGapFor(0.99)).toBe(0);
		expect(barGapFor(0)).toBe(0);
	});
});

describe("formatISODate", () => {
	it("formats date with 2-digit padding for month and day", () => {
		const date = new Date(2024, 0, 5); // Jan 5, 2024
		expect(formatISODate(date)).toBe("2024-01-05");
	});

	it("formats date with 2-digit month and day without extra padding", () => {
		const date = new Date(2024, 11, 25); // Dec 25, 2024
		expect(formatISODate(date)).toBe("2024-12-25");
	});
});

