import { describe, expect, it } from 'vitest';

import { type Box, CREDIT_GAP, creditBottomOffset } from '$lib/credit-layout';

const box = (left: number, top: number, right: number, bottom: number): Box => ({
	left,
	top,
	right,
	bottom
});

// A 1440x900 map; the credits corner sits at the right edge, 370px wide
const container = box(0, 0, 1440, 900);
const credits = box(1070, 800, 1440, 858);

describe('creditBottomOffset', () => {
	it('leaves the credits in the corner when nothing is in their way', () => {
		expect(creditBottomOffset(credits, container, [])).toBe(0);
	});

	it('does not raise the credits for a blocker that is far to the left', () => {
		// Time selector in the middle of a wide screen, clear of the corner
		const selector = box(500, 850, 900, 900);
		expect(creditBottomOffset(credits, container, [{ box: selector, reach: 36 }])).toBe(0);
	});

	it('raises the credits just above a blocker that is horizontally in the way', () => {
		const selector = box(210, 850, 1230, 900);
		// 50px tall selector + the gap
		expect(creditBottomOffset(credits, container, [{ box: selector, reach: 36 }])).toBe(
			50 + CREDIT_GAP
		);
	});

	it('follows the real height of a taller panel (the satellite panel)', () => {
		const panel = box(256, 687, 768, 768);
		const narrow = box(600, 780, 1000, 860);
		expect(creditBottomOffset(narrow, box(0, 0, 1024, 768), [{ box: panel, reach: 36 }])).toBe(
			768 - 687 + CREDIT_GAP
		);
	});

	it('counts the chevron buttons that stick out of the time selector', () => {
		const selector = box(210, 850, 1000, 900);
		// The corner starts 20px right of the selector: only the reach makes the difference
		const nearby = box(1020, 800, 1440, 858);
		expect(creditBottomOffset(nearby, container, [{ box: selector, reach: 36 }])).toBe(
			50 + CREDIT_GAP
		);
		expect(creditBottomOffset(nearby, container, [{ box: selector, reach: 0 }])).toBe(0);
	});

	it('clears the tabs and bubbles that stick out above a blocker (lift)', () => {
		// The "Today" tab sits 18px above the selector's box, the time bubble 28px
		const selector = box(210, 850, 1230, 900);
		expect(creditBottomOffset(credits, container, [{ box: selector, reach: 36, lift: 32 }])).toBe(
			50 + 32 + CREDIT_GAP
		);
		// Without a lift the credits would sit on the tab: that is the bug this guards against
		expect(creditBottomOffset(credits, container, [{ box: selector, reach: 36 }])).toBe(
			50 + CREDIT_GAP
		);
		expect(creditBottomOffset(credits, container, [{ box: selector, reach: 36, lift: 0 }])).toBe(
			50 + CREDIT_GAP
		);
	});

	it('does not raise the credits for a lifted blocker that is out of their way', () => {
		const selector = box(500, 850, 900, 900);
		expect(creditBottomOffset(credits, container, [{ box: selector, reach: 36, lift: 32 }])).toBe(
			0
		);
	});

	it('clears the highest of several blockers (selector + replay bar)', () => {
		const selector = box(210, 850, 1230, 900);
		const replay = box(304, 715, 1136, 842);
		expect(
			creditBottomOffset(credits, container, [
				{ box: selector, reach: 36 },
				{ box: replay, reach: 8 }
			])
		).toBe(900 - 715 + CREDIT_GAP);
	});

	it('ignores blockers that are not rendered', () => {
		const hidden = box(0, 0, 0, 0);
		const collapsed = box(300, 850, 900, 850);
		expect(
			creditBottomOffset(credits, container, [
				{ box: hidden, reach: 36 },
				{ box: collapsed, reach: 36 }
			])
		).toBe(0);
	});

	it('measures from the bottom of the map container, not of the window', () => {
		// Map inset 40px from the bottom of the window
		const inset = box(0, 0, 1440, 860);
		const selector = box(210, 850, 1230, 900);
		expect(creditBottomOffset(credits, inset, [{ box: selector, reach: 36 }])).toBe(
			860 - 850 + CREDIT_GAP
		);
	});

	it('never returns a negative offset', () => {
		// A blocker below the bottom edge of the container
		const below = box(0, 950, 1440, 1000);
		expect(creditBottomOffset(credits, container, [{ box: below, reach: 36 }])).toBe(0);
	});

	it('rounds up to whole pixels', () => {
		const selector = box(210, 849.4, 1230, 900);
		expect(creditBottomOffset(credits, container, [{ box: selector, reach: 36 }])).toBe(
			Math.ceil(900 - 849.4 + CREDIT_GAP)
		);
	});
});
