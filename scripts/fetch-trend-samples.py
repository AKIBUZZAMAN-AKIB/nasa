#!/usr/bin/env python3
"""Build the bundled sample datasets used by the Earth System Trend Explorer.

Some NASA datasets cannot be read live from a static web page: the ORNL DAAC
MODIS web service is slow (10-60 s per request of 10 composites) and the
NOAA CoastWatch ERDDAP and NSIDC servers send no CORS headers. This script
fetches them once, server side, and writes compact monthly series to
`static/trend-samples/*.json`. The app labels every value that comes from
these files as a bundled sample, with the retrieval date and the source URL.

Run:  python3 scripts/fetch-trend-samples.py [ndvi|npp|sst|chl|seaice|all]
Raw responses are cached in .cache/trend-samples so an interrupted run
resumes where it stopped.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import statistics
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'static' / 'trend-samples'
CACHE = ROOT / '.cache' / 'trend-samples'
ORNL = 'https://modis.ornl.gov/rst/api/v1'
ERDDAP = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap'
NSIDC = 'https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data'

# Rural/vegetated sample sites near each Bangladesh division (city centres are
# avoided because urban pixels say little about vegetation), plus the
# Sundarbans mangrove forest. Ids match src/lib/trend/regions.ts.
LAND_SITES = {
	'rajshahi': (24.50, 88.80),
	'dhaka': (23.86, 89.95),
	'chattogram': (23.35, 91.05),
	'khulna': (23.10, 89.20),
	'sylhet': (24.75, 91.65),
	'rangpur': (25.85, 89.15),
	'barishal': (22.65, 90.25),
	'mymensingh': (24.85, 90.25),
	'sundarbans': (21.95, 89.20),
}

# Open-water sample points. Ids match src/lib/trend/regions.ts.
OCEAN_SITES = {
	'bay-north': (20.5, 89.5),
	'bay-central': (15.0, 88.0),
}


def get(url: str, accept: str = 'application/json', tries: int = 6) -> bytes:
	delay = 5
	for attempt in range(tries):
		try:
			req = urllib.request.Request(
				url, headers={'Accept': accept, 'User-Agent': 'earth-system-trend-explorer/1.0'}
			)
			with urllib.request.urlopen(req, timeout=240) as r:
				return r.read()
		except Exception as e:  # noqa: BLE001
			if attempt == tries - 1:
				raise
			print(f'  retry {attempt + 1} after {e}: {url[:120]}', flush=True)
			time.sleep(delay)
			delay = min(delay * 2, 60)
	raise RuntimeError('unreachable')


def cached(name: str, url: str, accept: str = 'application/json') -> bytes:
	path = CACHE / name
	if path.exists() and path.stat().st_size > 0:
		return path.read_bytes()
	data = get(url, accept)
	path.parent.mkdir(parents=True, exist_ok=True)
	path.write_bytes(data)
	return data


def write(name: str, payload: dict) -> None:
	OUT.mkdir(parents=True, exist_ok=True)
	(OUT / name).write_text(json.dumps(payload, separators=(',', ':')) + '\n')
	print(f'wrote {OUT / name}', flush=True)


def today() -> str:
	return dt.date.today().isoformat()


# ---------------------------------------------------------------------------
# MODIS NDVI (MOD13Q1, 250 m, 16-day) via the ORNL DAAC MODIS web service
# ---------------------------------------------------------------------------

NDVI_YEARS = range(2001, 2026)
NDVI_DOYS = list(range(1, 366, 16))  # 23 composites per year: 001, 017, ... 353
WINDOW_KM = 1  # 1 km either side: a 9 x 9 block of 250 m pixels


def ndvi_chunks() -> list[tuple[str, str]]:
	dates = [f'A{y}{d:03d}' for y in NDVI_YEARS for d in NDVI_DOYS]
	return [(dates[i], dates[min(i + 9, len(dates) - 1)]) for i in range(0, len(dates), 10)]


def fetch_ornl_site(product: str, band: str, site: str, lat: float, lon: float, chunks):
	rows = []
	for start, end in chunks:
		url = (
			f'{ORNL}/{product}/subset?latitude={lat}&longitude={lon}&band={band}'
			f'&startDate={start}&endDate={end}&kmAboveBelow={WINDOW_KM}&kmLeftRight={WINDOW_KM}'
		)
		body = json.loads(cached(f'{product}/{site}/{start}-{end}.json', url))
		scale = float(body.get('scale') or 1)
		for item in body.get('subset', []):
			rows.append((item['calendar_date'], item['data'], scale))
	print(f'  {product} {site}: {len(rows)} composites', flush=True)
	return rows


def build_ndvi() -> None:
	chunks = ndvi_chunks()

	def one(item):
		site, (lat, lon) = item
		rows = fetch_ornl_site('MOD13Q1', '250m_16_days_NDVI', site, lat, lon, chunks)
		# Median of the valid pixels in the block, then the monthly maximum of
		# the composites (maximum-value compositing, Holben 1986) to suppress
		# cloud-contaminated composites, which always pull NDVI down.
		monthly: dict[str, float] = {}
		for date, data, scale in rows:
			valid = [v * scale for v in data if -2000 <= v <= 10000]
			if len(valid) < max(3, len(data) // 4):
				continue
			value = statistics.median(valid)
			key = date[:4] + date[5:7]
			monthly[key] = round(max(monthly.get(key, -1.0), value), 4)
		return site, {'lat': lat, 'lon': lon, 'monthly': dict(sorted(monthly.items()))}

	with ThreadPoolExecutor(max_workers=len(LAND_SITES)) as pool:
		sites = dict(pool.map(one, LAND_SITES.items()))
	write(
		'modis-ndvi.json',
		{
			'dataset': 'MODIS Terra MOD13Q1 v6.1 NDVI (250 m, 16-day)',
			'source': 'ORNL DAAC MODIS/VIIRS Land Product Subsets web service',
			'url': f'{ORNL}/MOD13Q1/subset',
			'retrieved': today(),
			'method': (
				'Median of the valid pixels in a 9 x 9 block (about 2 x 2 km) around each site, '
				'then the maximum of the 16-day composites in each calendar month '
				'(maximum-value compositing) to suppress cloud contamination.'
			),
			'unit': 'NDVI',
			'sites': sites,
		},
	)


# ---------------------------------------------------------------------------
# MODIS annual net primary productivity (MOD17A3HGF, 500 m)
# ---------------------------------------------------------------------------


def build_npp() -> None:
	years = [f'A{y}001' for y in range(2001, 2025)]
	chunks = [(years[i], years[min(i + 9, len(years) - 1)]) for i in range(0, len(years), 10)]

	def one(item):
		site, (lat, lon) = item
		rows = fetch_ornl_site('MOD17A3HGF', 'Npp_500m', site, lat, lon, chunks)
		annual: dict[str, float] = {}
		for date, data, scale in rows:
			# Valid range 0..32700; larger values flag water, urban, barren.
			valid = [v * scale * 1000 for v in data if 0 <= v <= 32700]
			if len(valid) < max(3, len(data) // 4):
				continue
			annual[date[:4]] = round(statistics.median(valid), 1)
		return site, {'lat': lat, 'lon': lon, 'annual': dict(sorted(annual.items()))}

	with ThreadPoolExecutor(max_workers=3) as pool:
		sites = dict(pool.map(one, LAND_SITES.items()))
	write(
		'modis-npp.json',
		{
			'dataset': 'MODIS Terra MOD17A3HGF v6.1 net primary productivity (500 m, yearly)',
			'source': 'ORNL DAAC MODIS/VIIRS Land Product Subsets web service',
			'url': f'{ORNL}/MOD17A3HGF/subset',
			'retrieved': today(),
			'method': 'Median of the valid vegetated pixels in a 5 x 5 block (about 2 x 2 km) around each site.',
			'unit': 'g C/m²/yr',
			'sites': sites,
		},
	)


# ---------------------------------------------------------------------------
# ERDDAP: NASA JPL MUR SST and NASA MODIS-Aqua chlorophyll-a (monthly)
# ---------------------------------------------------------------------------


def erddap_series(dataset: str, var: str, start: str, end: str, lat: float, lon: float, name: str):
	url = f'{ERDDAP}/{dataset}.csv?{var}%5B({start}):1:({end})%5D%5B({lat})%5D%5B({lon})%5D'
	text = cached(f'{dataset}/{name}.csv', url, 'text/csv').decode()
	out: dict[str, float] = {}
	for row in list(csv.reader(io.StringIO(text)))[2:]:
		if len(row) < 4 or row[3] in ('', 'NaN'):
			continue
		out[row[0][:4] + row[0][5:7]] = round(float(row[3]), 4)
	return out


def build_sst() -> None:
	sites = {}
	for site, (lat, lon) in OCEAN_SITES.items():
		monthly = erddap_series('jplMURSST41mday', 'sst', '2002-06-16', '2025-12-16', lat, lon, site)
		sites[site] = {'lat': lat, 'lon': lon, 'monthly': monthly}
		print(f'  MUR {site}: {len(monthly)} months', flush=True)
	write(
		'mur-sst.json',
		{
			'dataset': 'NASA JPL MUR SST v4.1, monthly mean (0.01°)',
			'source': 'NOAA CoastWatch ERDDAP (dataset jplMURSST41mday)',
			'url': f'{ERDDAP}/jplMURSST41mday.html',
			'retrieved': today(),
			'method': 'Monthly mean sea surface temperature of the grid cell at each site.',
			'unit': '°C',
			'sites': sites,
		},
	)


def build_chl() -> None:
	sites = {}
	for site, (lat, lon) in OCEAN_SITES.items():
		monthly = erddap_series('erdMH1chlamday', 'chlorophyll', '2003-01-16', '2022-03-16', lat, lon, site)
		sites[site] = {'lat': lat, 'lon': lon, 'monthly': monthly}
		print(f'  CHL {site}: {len(monthly)} months', flush=True)
	write(
		'modis-chlorophyll.json',
		{
			'dataset': 'NASA MODIS-Aqua chlorophyll-a (OCI algorithm, 4 km, monthly)',
			'source': 'NOAA CoastWatch ERDDAP (dataset erdMH1chlamday)',
			'url': f'{ERDDAP}/erdMH1chlamday.html',
			'retrieved': today(),
			'method': 'Monthly composite chlorophyll-a of the 4 km cell at each site; cloud-covered months are missing.',
			'unit': 'mg/m³',
			'sites': sites,
		},
	)


# ---------------------------------------------------------------------------
# NSIDC Sea Ice Index v4: Arctic monthly sea-ice extent
# ---------------------------------------------------------------------------


def build_seaice() -> None:
	monthly: dict[str, float] = {}
	for m in range(1, 13):
		url = f'{NSIDC}/N_{m:02d}_extent_v4.0.csv'
		text = cached(f'nsidc/N_{m:02d}.csv', url, 'text/csv').decode()
		for row in list(csv.reader(io.StringIO(text)))[1:]:
			if len(row) < 5:
				continue
			try:
				year, month, extent = int(row[0]), int(row[1]), float(row[4])
			except ValueError:
				continue
			if extent < 0:
				continue  # -9999 marks the missing months of 1987/88
			monthly[f'{year}{month:02d}'] = extent
	write(
		'nsidc-sea-ice.json',
		{
			'dataset': 'NSIDC Sea Ice Index v4 (G02135), Arctic monthly sea-ice extent',
			'source': 'National Snow and Ice Data Center (NOAA@NSIDC)',
			'url': f'{NSIDC}/',
			'retrieved': today(),
			'method': 'Monthly mean extent of ocean with at least 15 % ice concentration, from passive-microwave satellites.',
			'unit': 'million km²',
			'sites': {'arctic': {'lat': 90, 'lon': 0, 'monthly': dict(sorted(monthly.items()))}},
		},
	)


BUILDERS = {'seaice': build_seaice, 'sst': build_sst, 'chl': build_chl, 'npp': build_npp, 'ndvi': build_ndvi}

if __name__ == '__main__':
	wanted = sys.argv[1:] or ['all']
	for name, build in BUILDERS.items():
		if 'all' in wanted or name in wanted:
			print(f'== {name}', flush=True)
			try:
				build()
			except Exception as e:  # noqa: BLE001
				print(f'!! {name} failed: {e}', flush=True)
