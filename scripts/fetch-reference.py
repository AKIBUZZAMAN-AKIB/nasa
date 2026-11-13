#!/usr/bin/env python3
"""
Build static/trend-samples/nasa-gistemp.json: NASA GISTEMP v4 monthly
surface temperature anomalies averaged over each predefined land region.

GISTEMP is read from the NOAA PSL OPeNDAP mirror (open access, no login),
because the GISS site offers the gridded file only as one large NetCDF.
With the argument `reference` it instead builds
static/trend-samples/reference-psl.json: independent monthly reference
series for the dataset-agreement and homogeneity check (GHCN_CAMS station
temperature, GPCP precipitation, CPC soil moisture, NCEP reanalysis
humidity, solar radiation and air temperature):
    python3 scripts/fetch-reference.py reference

Region means are cos(latitude) weighted means of the grid cells whose centres
fall inside the region (the nearest cell when none does).

Usage: python3 scripts/fetch-reference.py
(needs /tmp/regions.json; write it with
 node --experimental-strip-types -e "import('./src/lib/trend/regions.ts').then(m => require('fs').writeFileSync('/tmp/regions.json', JSON.stringify(m.REGIONS)))")
"""

import datetime as dt
import json
import math
import re
import sys
import time
import urllib.request

BASE = 'https://psl.noaa.gov/thredds/dodsC/Datasets/'
START_YEAR = 1981

DATASETS = {
	'ghcncams_t2m': {
		'path': 'ghcncams/air.mon.mean.nc',
		'var': 'air',
		'first': (1948, 1),
		'res': 0.5,
		'convert': lambda v: v - 273.15,
		'name': 'GHCN_CAMS gridded 2 m air temperature (station based)',
		'unit': '°C'
	},
	'gpcp_precip': {
		'path': 'gpcp/precip.mon.mean.nc',
		'var': 'precip',
		'first': (1979, 1),
		'res': 2.5,
		'convert': lambda v: v,
		'name': 'GPCP v2.3 monthly precipitation (satellite + gauge)',
		'unit': 'mm/day'
	},
	'gistemp_t2m': {
		'path': 'gistemp/combined/250km/air.2x2.250.mon.anom.comb.nc',
		'var': 'air',
		'first': (1880, 1),
		'start': 1951,
		'res': 2.0,
		'convert': lambda v: v,
		'name': 'NASA GISS Surface Temperature Analysis v4 (GISTEMP), 250 km smoothing',
		'unit': '°C anomaly vs 1951–1980'
	},
	'r2_air2m': {
		'path': 'ncep.reanalysis2/Monthlies/gaussian_grid/air.2m.mon.mean.nc',
		'var': 'air',
		'first': (1979, 1),
		'level': True,
		'res': 1.9,
		'convert': lambda v: v - 273.15,
		'name': 'NCEP-DOE Reanalysis 2 2 m air temperature',
		'unit': '°C'
	},
	'r2_dswrf': {
		'path': 'ncep.reanalysis2/Monthlies/gaussian_grid/dswrf.sfc.mon.mean.nc',
		'var': 'dswrf',
		'first': (1979, 1),
		'res': 1.9,
		'convert': lambda v: v,
		'name': 'NCEP-DOE Reanalysis 2 surface downward solar radiation',
		'unit': 'W/m²'
	},
	'r1_rhum': {
		'path': 'ncep.reanalysis.derived/surface/rhum.sig995.mon.mean.nc',
		'var': 'rhum',
		'first': (1948, 1),
		'res': 2.5,
		'convert': lambda v: v,
		'name': 'NCEP/NCAR Reanalysis 1 near-surface relative humidity (sigma 0.995)',
		'unit': '%'
	},
	'cpc_soilw': {
		'path': 'cpcsoil/soilw.mon.mean.nc',
		'var': 'soilw',
		'first': (1948, 1),
		'res': 0.5,
		'convert': lambda v: v,
		'name': 'CPC soil moisture (observation-driven bucket model)',
		'unit': 'mm'
	}
}


def get(url: str, tries: int = 4) -> str:
	for i in range(tries):
		try:
			with urllib.request.urlopen(url, timeout=180) as r:
				return r.read().decode()
		except Exception as e:  # noqa: BLE001
			if i == tries - 1:
				raise
			print('  retry', e, file=sys.stderr)
			time.sleep(5 * (i + 1))
	return ''


def axis(path: str, name: str) -> list[float]:
	text = get(f'{BASE}{path}.ascii?{name}')
	body = text.split('---------------------------------------------')[-1]
	line = body.strip().split('\n', 1)[1]
	return [float(x) for x in line.replace('\n', ' ').split(',') if x.strip()]


def point_in_polygon(lon: float, lat: float, poly: list[list[float]]) -> bool:
	inside = False
	j = len(poly) - 1
	for i in range(len(poly)):
		xi, yi = poly[i]
		xj, yj = poly[j]
		if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
			inside = not inside
		j = i
	return inside


def in_region(region: dict, lon: float, lat: float) -> bool:
	w, s, e, n = region['bbox']
	if not (w <= lon <= e and s <= lat <= n):
		return False
	poly = region.get('polygon')
	return point_in_polygon(lon, lat, poly) if poly else True


def main() -> None:
	regions = [r for r in json.load(open('/tmp/regions.json')) if r['domain'] == 'land']
	out = {
		'dataset': 'NOAA PSL observation-based reference series',
		'provider': 'NOAA Physical Sciences Laboratory, Boulder, Colorado (https://psl.noaa.gov/)',
		'retrieved': dt.date.today().isoformat(),
		'method': 'cos(latitude)-weighted mean of grid cells with centres inside the region (nearest cell when none)',
		'datasets': {},
		'series': {}
	}
	arg = sys.argv[1] if len(sys.argv) > 1 else 'gistemp_t2m'
	keys = [k for k in DATASETS if k != 'gistemp_t2m'] if arg == 'reference' else arg.split(',')
	for key in keys:
		ds = DATASETS[key]
		print('==', key, file=sys.stderr)
		lats = axis(ds['path'], 'lat')
		lons = axis(ds['path'], 'lon')
		fy, fm = ds['first']
		nt_all = int(re.search(r'time = (\d+)', get(f"{BASE}{ds['path']}.dds")).group(1))
		t0 = (ds.get('start', START_YEAR) - fy) * 12 + (1 - fm)
		out['datasets'][key] = {
			'name': ds['name'],
			'unit': ds['unit'],
			'resolution': f"{ds['res']}°, monthly",
			'url': f"https://psl.noaa.gov/thredds/catalog/Datasets/{ds['path'].split('/')[0]}/catalog.html"
		}
		out['series'][key] = {}
		for region in regions:
			cells = []
			for i, la in enumerate(lats):
				for j, lo in enumerate(lons):
					lo180 = lo - 360 if lo > 180 else lo
					if in_region(region, lo180, la):
						cells.append((i, j, la))
			if not cells:
				clon, clat = region['center']
				i = min(range(len(lats)), key=lambda k: abs(lats[k] - clat))
				j = min(range(len(lons)), key=lambda k: abs((lons[k] - 360 if lons[k] > 180 else lons[k]) - clon))
				cells = [(i, j, lats[i])]
			i0, i1 = min(c[0] for c in cells), max(c[0] for c in cells)
			j0, j1 = min(c[1] for c in cells), max(c[1] for c in cells)
			lev = '[0:1:0]' if ds.get('level') else ''
			url = f"{BASE}{ds['path']}.ascii?{ds['var']}[{t0}:1:{nt_all - 1}]{lev}[{i0}:1:{i1}][{j0}:1:{j1}]"
			text = get(url)
			grid: dict[tuple[int, int, int], float] = {}
			body = text.split('---------------------------------------------')[-1]
			for line in body.split('\n'):
				m = re.match(r'^\[(\d+)\]\[(\d+)\],\s*(.*)$', line.strip()) if not ds.get('level') else re.match(r'^\[(\d+)\]\[0\]\[(\d+)\],\s*(.*)$', line.strip())
				if m:
					t, a = int(m.group(1)), int(m.group(2))
					for b, v in enumerate(m.group(3).split(',')):
						grid[(t, a, b)] = float(v)
			nt = max(k[0] for k in grid) + 1 if grid else 0
			wanted = {(c[0] - i0, c[1] - j0): math.cos(math.radians(c[2])) for c in cells}
			monthly = {}
			for t in range(nt):
				total = 0.0
				wsum = 0.0
				for (a, b), w in wanted.items():
					v = grid.get((t, a, b))
					if v is None or not math.isfinite(v) or abs(v) > 1e30:
						continue
					total += ds['convert'](v) * w
					wsum += w
				if wsum >= 0.75 * sum(wanted.values()):
					idx = t0 + t
					y = fy + (fm - 1 + idx) // 12
					mo = (fm - 1 + idx) % 12 + 1
					monthly[f'{y}{mo:02d}'] = round(total / wsum, 3)
			out['series'][key][region['id']] = {'cells': len(cells), 'monthly': monthly}
			ks = sorted(monthly)
			print(f"  {region['id']}: {len(cells)} cells, {len(ks)} months {ks[:1]}..{ks[-1:]}", file=sys.stderr)
	target = 'static/trend-samples/' + ('nasa-gistemp.json' if keys == ['gistemp_t2m'] else 'reference-psl.json')
	if keys == ['gistemp_t2m']:
		out = as_sample_file(out, regions)
	json.dump(out, open(target, 'w'), separators=(',', ':'))


def as_sample_file(out: dict, regions: list[dict]) -> dict:
	"""GISTEMP is shown as its own variable, so it uses the sample-file format
	(one 'site' per region, keyed by the region id)."""
	centres = {r['id']: r['center'] for r in regions}
	series = out['series']['gistemp_t2m']
	return {
		'dataset': 'NASA GISTEMP v4 surface temperature anomaly (250 km smoothing)',
		'source': 'NASA Goddard Institute for Space Studies, read from the NOAA PSL OPeNDAP mirror',
		'url': 'https://data.giss.nasa.gov/gistemp/',
		'retrieved': out['retrieved'],
		'method': 'Monthly anomalies (°C, relative to 1951–1980) averaged over the 2° GISTEMP cells inside the region, weighted by cos(latitude).',
		'unit': '°C',
		'regionKeyed': True,
		'sites': {
			rid: {'lat': centres[rid][1], 'lon': centres[rid][0], 'cells': v['cells'], 'monthly': v['monthly']}
			for rid, v in series.items()
		}
	}


if __name__ == '__main__':
	main()
