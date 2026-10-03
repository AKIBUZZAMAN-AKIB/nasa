import { get } from 'svelte/store';

import { archiveState } from '$lib/stores/archive';
import { map } from '$lib/stores/map';
import { powerPanelState } from '$lib/stores/power';

const POWER_SVG = `<button aria-label="NASA POWER data explorer" style="display:flex;justify-content:center;align-items:center;">
	<svg xmlns="http://www.w3.org/2000/svg" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" opacity="0.78" class="lucide lucide-sun-medium-icon lucide-sun-medium">
		<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
	</svg>
</button>`;

const POWER_ACTIVE_SVG = `<button aria-label="NASA POWER data explorer" style="display:flex;justify-content:center;align-items:center;color:rgb(51,181,229);">
	<svg xmlns="http://www.w3.org/2000/svg" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun-medium-icon lucide-sun-medium">
		<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
	</svg>
</button>`;

/** Opens POWER's point/regional data explorer at the current map location. */
export class PowerButton {
	private unsubscribe: () => void = () => {};

	onAdd() {
		const div = document.createElement('div');
		div.className = 'maplibregl-ctrl maplibregl-ctrl-group';
		div.title = 'NASA POWER data explorer';

		const refresh = () => {
			div.innerHTML = get(powerPanelState).open ? POWER_ACTIVE_SVG : POWER_SVG;
		};
		this.unsubscribe = powerPanelState.subscribe(refresh);

		div.addEventListener('contextmenu', (event) => event.preventDefault());
		div.addEventListener('click', () => {
			const state = get(powerPanelState);
			if (state.open) {
				powerPanelState.update((current) => ({ ...current, open: false, pickingLocation: false }));
				return;
			}

			const center = get(map)?.getCenter();
			archiveState.update((current) => ({ ...current, open: false }));
			powerPanelState.set({
				open: true,
				latitude: center?.lat ?? state.latitude ?? 0,
				longitude: center?.lng ?? state.longitude ?? 0,
				pickingLocation: false
			});
		});

		return div;
	}

	onRemove() {
		this.unsubscribe();
	}
}
