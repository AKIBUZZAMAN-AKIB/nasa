/**
 * Layout maths for the map credits corner (copyright line, plus the Maptoolkit
 * logo when that basemap is active). Pure, so it can be unit tested;
 * `attribution.ts` feeds it real DOM measurements.
 */

export type Box = { left: number; right: number; top: number; bottom: number };

/** Something that can sit above the credits corner and must not cover it. */
export type Blocker = {
	box: Box;
	/** How far the blocker's real footprint reaches past its box, sideways. */
	reach: number;
	/**
	 * How far parts of it stick out above its box (tabs, buttons, bubbles and
	 * tooltips that are positioned with a negative `top`). A box measured with
	 * getBoundingClientRect() does not include them.
	 */
	lift?: number;
};

/** Space kept between the raised credits and what they sit above. */
export const CREDIT_GAP = 8;

/**
 * How far the credits corner has to be raised from the bottom edge of its
 * container to sit just above every blocker that is horizontally in its way.
 * Returns 0 when nothing is in the way, so on wide screens the credits stay in
 * the corner.
 *
 * Only horizontal extents decide whether a blocker is in the way: raising the
 * credits changes their vertical position, so a vertical check would switch
 * itself back off.
 */
export const creditBottomOffset = (
	credits: Box,
	container: Box,
	blockers: Blocker[],
	gap: number = CREDIT_GAP
): number => {
	let clearance = 0;
	for (const { box, reach, lift = 0 } of blockers) {
		const rendered = box.right > box.left && box.bottom > box.top;
		if (!rendered) continue;
		const inTheWay = credits.left < box.right + reach && credits.right > box.left - reach;
		if (inTheWay) clearance = Math.max(clearance, container.bottom - (box.top - lift));
	}
	return clearance > 0 ? Math.ceil(clearance + gap) : 0;
};
