import { get } from 'svelte/store';

import { gibsPanelOpen, toggleGibsPanel } from '$lib/stores/gibs';

/**
 * Toggles the satellite history panel.
 *
 * The imagery itself is a map layer managed in `$lib/gibs-layers`; the button
 * only opens the panel that chooses the layer and date.
 */
const SATELLITE_SVG = `<button style="display:flex;justify-content:center;align-items:center;">
	<svg xmlns="http://www.w3.org/2000/svg" opacity="0.75" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-satellite-icon lucide-satellite"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m8 12 4 4 6-6-4-4Z"/><path d="m16 8 3-3"/><path d="M9 21a6 6 0 0 0-6-6"/></svg>
	</button>`;

const SATELLITE_ACTIVE_SVG = `<button style="display:flex;justify-content:center;align-items:center;color:rgb(51,181,229);">
	<svg xmlns="http://www.w3.org/2000/svg" opacity="1" stroke-width="1.5" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-satellite-icon lucide-satellite"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m8 12 4 4 6-6-4-4Z"/><path d="m16 8 3-3"/><path d="M9 21a6 6 0 0 0-6-6"/></svg>
	</button>`;

export class GibsButton {
	private subscription: () => void;

	constructor() {
		this.subscription = () => {};
	}

	onAdd() {
		const div = document.createElement('div');
		div.className = 'maplibregl-ctrl maplibregl-ctrl-group';
		div.title = 'Satellite history (NASA GIBS)';

		const updateIcon = () => {
			div.innerHTML = get(gibsPanelOpen) ? SATELLITE_ACTIVE_SVG : SATELLITE_SVG;
		};

		this.subscription = gibsPanelOpen.subscribe(updateIcon);

		div.addEventListener('contextmenu', (event) => event.preventDefault());
		div.addEventListener('click', () => toggleGibsPanel());

		updateIcon();
		return div;
	}

	onRemove() {
		this.subscription?.();
	}
}
