// Keeps the map credits (the copyright line and, with the Maptoolkit basemap,
// its logo) clear of the UI along the bottom of the screen: they are raised to
// sit just above the time selector, the satellite (GIBS) panel that replaces
// it, and the replay bar that opens above it, whenever one of those is
// horizontally in their way. On wide screens where there is room, they stay in
// the corner.
//
// Two custom properties are published for the rest of the UI (see styles.css):
//   --om-credit-bottom  distance of the credits from the bottom edge
//   --om-credit-height  height of the credits (logo + copyright line)
// Floating UI that sits near that corner (the historical panel, toasts) uses
// them to stay clear as well: Maptoolkit's terms do not allow anything to cover
// its logo or its copyright line.
import { browser } from '$app/env';

import { type Blocker, creditBottomOffset } from './credit-layout';

const CREDITS_SELECTOR = '.maplibregl-ctrl-bottom-right';
// The time selector's chevron buttons stick out 28px on each side of its
// border box, plus a little breathing room (`reach`). Its "Today" tab, the
// Replay button and the time bubble stick out up to 28px above the box, and
// its hover tooltip 32px (`-top-8`); a box measurement does not include them,
// so `lift` covers the tallest one. Other blockers have no such parts.
const BLOCKERS = [
	{ selector: '.time-selector-container', reach: 36, lift: 32 },
	// The replay bar flies in above the time selector
	{ selector: '[data-credit-blocker]', reach: 8, lift: 0 }
];
// While a modal (Settings sheet, Help dialog) is open, the page behind it is
// dimmed and cannot be used, so the credits stay in their corner instead of
// rising to clear UI nobody can reach. They are drawn above the modal (see
// styles.css) and sit on its bottom padding.
const MODAL_SELECTOR = '[role="dialog"][data-state="open"]';
const BOTTOM_PROPERTY = '--om-credit-bottom';
const HEIGHT_PROPERTY = '--om-credit-height';
// Enter transitions (the replay bar flies in) end after the first measurement
const SETTLE_MS = 400;

let resizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;
let listenerController: AbortController | undefined;
let frame = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

const updateCredits = () => {
	if (!browser) return;
	const credits = document.querySelector<HTMLElement>(CREDITS_SELECTOR);
	if (!credits) return;

	const creditsBox = credits.getBoundingClientRect();
	const container = (credits.offsetParent ?? document.documentElement).getBoundingClientRect();
	const modalOpen = document.querySelector(MODAL_SELECTOR) !== null;
	const blockers: Blocker[] = modalOpen
		? []
		: BLOCKERS.flatMap(({ selector, reach, lift }) =>
				[...document.querySelectorAll(selector)].map((element) => ({
					box: element.getBoundingClientRect(),
					reach,
					lift
				}))
			);

	const root = document.documentElement.style;
	root.setProperty(BOTTOM_PROPERTY, `${creditBottomOffset(creditsBox, container, blockers)}px`);
	root.setProperty(HEIGHT_PROPERTY, `${Math.ceil(creditsBox.height)}px`);
};

const schedule = () => {
	if (!frame) {
		frame = requestAnimationFrame(() => {
			frame = 0;
			updateCredits();
		});
	}
	clearTimeout(settleTimer);
	settleTimer = setTimeout(updateCredits, SETTLE_MS);
};

// Elements are looked up again on every DOM change: the replay bar and the
// time selector come and go, and observe() ignores an element it already has.
const observeTargets = () => {
	const selectors = [CREDITS_SELECTOR, ...BLOCKERS.map(({ selector }) => selector)];
	for (const element of document.querySelectorAll(selectors.join(','))) {
		resizeObserver?.observe(element);
	}
};

export const watchAttributionOverlap = () => {
	if (!browser) {
		return;
	}
	unwatchAttributionOverlap();

	// Reacts to the credits changing size (attribution text, logo added or
	// removed with the basemap) and to the blockers growing or shrinking.
	resizeObserver = new ResizeObserver(schedule);
	mutationObserver = new MutationObserver(() => {
		observeTargets();
		schedule();
	});
	mutationObserver.observe(document.body, { childList: true, subtree: true });

	// Sizes can stay the same while the gap between credits and blockers changes.
	listenerController = new AbortController();
	window.addEventListener('resize', schedule, { signal: listenerController.signal });

	observeTargets();
	updateCredits();
};

export const unwatchAttributionOverlap = () => {
	if (!browser) {
		return;
	}
	resizeObserver?.disconnect();
	resizeObserver = undefined;
	mutationObserver?.disconnect();
	mutationObserver = undefined;
	listenerController?.abort();
	listenerController = undefined;
	cancelAnimationFrame(frame);
	frame = 0;
	clearTimeout(settleTimer);
	settleTimer = undefined;
	document.documentElement.style.removeProperty(BOTTOM_PROPERTY);
	document.documentElement.style.removeProperty(HEIGHT_PROPERTY);
};
