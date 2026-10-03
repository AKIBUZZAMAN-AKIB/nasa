import { writable } from 'svelte/store';

export interface PowerPanelState {
	open: boolean;
	latitude?: number;
	longitude?: number;
	pickingLocation: boolean;
}

export interface PowerGridPoint {
	type: 'Feature';
	geometry: {
		type: 'Point';
		coordinates: [number, number];
	};
	properties: {
		value: number;
		key: string;
		latitude: number;
		longitude: number;
	};
}

export interface PowerGridOverlay {
	parameter: string;
	name: string;
	unit: string;
	period: string;
	min: number;
	max: number;
	features: PowerGridPoint[];
}

export const powerPanelState = writable<PowerPanelState>({
	open: false,
	pickingLocation: false
});

export const powerGridOverlay = writable<PowerGridOverlay | undefined>(undefined);
export const powerGridVisible = writable(true);

export function closePowerPanel(): void {
	powerPanelState.update((state) => ({ ...state, open: false, pickingLocation: false }));
}

export function clearPowerGridOverlay(): void {
	powerGridOverlay.set(undefined);
	powerGridVisible.set(false);
}
