/**
 * The explorer's selection, and how it is written to and read from the
 * address bar so a result can be shared as a link.
 */
import { DEFAULT_VARIABLE_ID, SEASONS, variableById } from './catalog';
import { DEFAULT_REGION_ID, customRegion, regionById } from './regions';

export type Mode = 'everyday' | 'research';

export interface Selection {
	variableId: string;
	regionId: string;
	seasonId: string;
	from?: number;
	to?: number;
	mode: Mode;
}

export const DEFAULT_SELECTION: Selection = {
	variableId: DEFAULT_VARIABLE_ID,
	regionId: DEFAULT_REGION_ID,
	seasonId: 'annual',
	mode: 'everyday'
};

const YEAR = /^(19|20)\d\d$/;

/** Read a selection from URL search parameters; unknown values fall back to the defaults. */
export function parseSelection(params: URLSearchParams): Selection {
	const sel: Selection = { ...DEFAULT_SELECTION };
	const v = params.get('v');
	if (v && variableById(v)) sel.variableId = v;
	const r = params.get('r');
	if (r && (regionById(r) || customRegion(r))) sel.regionId = r;
	const s = params.get('s');
	if (s && SEASONS.some((x) => x.id === s)) sel.seasonId = s;
	const from = params.get('from');
	const to = params.get('to');
	if (from && YEAR.test(from)) sel.from = Number(from);
	if (to && YEAR.test(to)) sel.to = Number(to);
	if (sel.from !== undefined && sel.to !== undefined && sel.from > sel.to) {
		[sel.from, sel.to] = [sel.to, sel.from];
	}
	const mode = params.get('mode');
	if (mode === 'research' || mode === 'everyday') sel.mode = mode;
	return sel;
}

/** Search string for a selection; defaults are left out to keep links short. */
export function selectionQuery(sel: Selection): string {
	const p = new URLSearchParams();
	p.set('v', sel.variableId);
	p.set('r', sel.regionId);
	if (sel.seasonId !== 'annual') p.set('s', sel.seasonId);
	if (sel.from !== undefined) p.set('from', String(sel.from));
	if (sel.to !== undefined) p.set('to', String(sel.to));
	if (sel.mode !== 'everyday') p.set('mode', sel.mode);
	return p.toString();
}

/** A ready-made question that sets a whole selection, for the quick starts and the farmer story. */
export interface Preset {
	id: string;
	title: string;
	question: string;
	selection: Omit<Selection, 'mode'>;
}

export const QUICK_STARTS: Preset[] = [
	{
		id: 'bd-warming',
		title: 'Bangladesh warming',
		question: 'Is Bangladesh getting hotter?',
		selection: { variableId: 'gistemp', regionId: 'bangladesh', seasonId: 'annual' }
	},
	{
		id: 'bay-sst',
		title: 'Bay of Bengal',
		question: 'Is the sea next to us warming?',
		selection: { variableId: 'sst_merra', regionId: 'bay-north', seasonId: 'annual' }
	},
	{
		id: 'greening',
		title: 'Greener land',
		question: 'Is vegetation in Bangladesh changing?',
		selection: { variableId: 'ndvi', regionId: 'bangladesh', seasonId: 'annual' }
	},
	{
		id: 'dhaka-haze',
		title: 'Winter haze',
		question: 'Is winter haze over Dhaka getting worse?',
		selection: { variableId: 'aod', regionId: 'dhaka', seasonId: 'winter' }
	},
	{
		id: 'himalaya-frost',
		title: 'Himalaya frost',
		question: 'Are frost days in the Himalaya disappearing?',
		selection: { variableId: 'frost_days', regionId: 'kangchenjunga', seasonId: 'annual' }
	},
	{
		id: 'arctic-ice',
		title: 'Arctic sea ice',
		question: 'How fast is Arctic sea ice shrinking in September?',
		selection: { variableId: 'sea_ice', regionId: 'arctic', seasonId: 'm9' }
	}
];

/**
 * The pitch's farmer use case for Rajshahi, over the GPM era (2001 on), so
 * all three answers cover the same years and can be compared.
 */
export const FARMER_STORY: Preset[] = [
	{
		id: 'farmer-rain',
		title: 'Rainfall',
		question: 'Is monsoon rainfall in Rajshahi decreasing?',
		selection: {
			variableId: 'rain_imerg',
			regionId: 'rajshahi',
			seasonId: 'monsoon',
			from: 2001
		}
	},
	{
		id: 'farmer-soil',
		title: 'Soil moisture',
		question: 'Is the soil under the crops getting drier in the dry season?',
		selection: {
			variableId: 'soil_root',
			regionId: 'rajshahi',
			seasonId: 'premonsoon',
			from: 2001
		}
	},
	{
		id: 'farmer-ndvi',
		title: 'Vegetation',
		question: 'Are the fields and trees around Rajshahi getting browner?',
		selection: { variableId: 'ndvi', regionId: 'rajshahi', seasonId: 'annual', from: 2001 }
	}
];
