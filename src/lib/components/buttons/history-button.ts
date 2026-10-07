import { get } from 'svelte/store';

import { analysisState, closeAnalysis, openAnalysisAt } from '$lib/stores/analysis';
import { getArchiveVariable } from '$lib/stores/archive';
import { activeChart, pickPrimaryVariable } from '$lib/stores/chart';
import { map } from '$lib/stores/map';
import { closePowerPanel } from '$lib/stores/power';

/**
 * Toggles the historical analysis panel.
 *
 * The archive is point-based, so unlike the forecast layers it has no spatial
 * form to paint on the map. The button therefore only opens the panel, seeded
 * with the map centre and the variable currently on the map; the panel owns
 * everything after that, including picking a new location.
 */
const CHART_SVG = `<button style="display:flex;justify-content:center;align-items:center;">
	<svg xmlns="http://www.w3.org/2000/svg" opacity="0.75" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chart-spline-icon lucide-chart-spline"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m7 14 4-4 3 3 5-6"/></svg>
	</button>`;

const CHART_ACTIVE_SVG = `<button style="display:flex;justify-content:center;align-items:center;color:rgb(51,181,229);">
	<svg xmlns="http://www.w3.org/2000/svg" opacity="1" stroke-width="1.5" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chart-spline-icon lucide-chart-spline"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m7 14 4-4 3 3 5-6"/></svg>
	</button>`;

export class HistoryButton {
	private subscription: () => void;

	constructor() {
		this.subscription = () => {};
	}

	onAdd() {
		const div = document.createElement('div');
		div.className = 'maplibregl-ctrl maplibregl-ctrl-group';
		div.title = 'Historical analysis';

		const updateIcon = () => {
			div.innerHTML = get(analysisState).open ? CHART_ACTIVE_SVG : CHART_SVG;
		};

		this.subscription = analysisState.subscribe(updateIcon);

		div.addEventListener('contextmenu', (e) => e.preventDefault());
		div.addEventListener('click', () => {
			const state = get(analysisState);
			if (state.open) {
				closeAnalysis();
				return;
			}
			// The two data explorers share the same map corner; show one panel at a time.
			closePowerPanel();
			// Seed with the map centre and load immediately, carrying the on-map
			// variable across as the Open-Meteo default.
			const centre = get(map)?.getCenter();
			const variable = pickPrimaryVariable(get(activeChart));
			openAnalysisAt(centre?.lat ?? state.latitude ?? 0, centre?.lng ?? state.longitude ?? 0, {
				omVariable: getArchiveVariable(variable) ? variable : state.omVariable
			});
		});

		updateIcon();
		return div;
	}

	onRemove() {
		this.subscription?.();
	}
}
