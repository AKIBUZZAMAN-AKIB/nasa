# Open-Meteo Maps

[![codecov](https://codecov.io/gh/open-meteo/maps/graph/badge.svg?token=QRHSC0EGJ8)](https://codecov.io/gh/open-meteo/maps)
[![Tests & Build](https://github.com/open-meteo/maps/actions/workflows/build.yml/badge.svg)](https://github.com/open-meteo/maps/actions/workflows/build.yml)
[![GitHub license](https://img.shields.io/github/license/open-meteo/maps)](https://github.com/open-meteo/maps/blob/main/LICENSE)

A UI demo for the [Open-Meteo Weather Map Layer](https://github.com/open-meteo/weather-map-layer) — a MapLibre/Mapbox GL JS weather layer powered by Open-Meteo OMfiles.

![Open-Meteo Maps UI example](https://static-assets.open-meteo.com/maps/media/example.png)

## About

This is a client-side app that fetches OMfiles from `data-spatial.open-meteo.com` and renders them with MapLibre GL. Weather tiles are fully rendered in the browser at the native model resolution — no server-side tile rendering required.

> Looking for the Open-Meteo API? See [open-meteo/open-meteo](https://github.com/open-meteo/open-meteo).

## Development

Requires Node LTS (see `.nvmrc`).

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
npm run preview
```

Generate the self-contained application HTML (written one directory above this repository by default):

```bash
npm run build:onefile
```

Run checks:

```bash
npm test          # vitest unit tests
npm run check     # svelte-check
npm run lint      # prettier + eslint
```

### Data endpoint

The app fetches OMfiles from `data-spatial.open-meteo.com` by default. Set `VITE_DATA_BASE_URI` (e.g. in `.env.local`) to point a build at a local or staging `data_spatial` endpoint.

The `data_spatial` tree is served from two places:

- `https://openmeteo.s3.amazonaws.com/data_spatial/...` is the AWS S3 origin. Public and uncached, with a browsable index at [openmeteo.s3.amazonaws.com](https://openmeteo.s3.amazonaws.com/index.html#data_spatial/). This is the endpoint used by the [weather-map-layer](https://github.com/open-meteo/weather-map-layer) README and examples.
- `https://data-spatial.open-meteo.com/data_spatial/...` is the endpoint this app uses. It only accepts requests with a `localhost` or `*.open-meteo.com` referer. The app automatically retries through S3 after an HTTP 403, because a standalone page may be hosted on an unrelated origin.

### Basemap and browser CORS

The Open-Meteo basemap style is retained, but its `tiles.open-meteo.com` vector TileJSON/MVT endpoint does not currently return `Access-Control-Allow-Origin` to browser clients. The app therefore loads the CORS-enabled public OpenFreeMap vector TileJSON and inlines its tile template into the style after verifying the required OpenMapTiles source layers. This avoids a public CORS proxy and preserves the style's attribution, including OpenFreeMap, OpenMapTiles, and OpenStreetMap. If the Open-Meteo style host is unavailable, the app falls back to OpenFreeMap's Positron/Dark style. OpenFreeMap's [Quick Start Guide](https://openfreemap.org/quick_start/) documents direct MapLibre style integration; its [service and attribution notes](https://openfreemap.org/) state that the public instance requires attribution and no API key. The public service is third-party infrastructure and is provided as-is; keep its attribution visible.

### Historical analysis data

The historical panel deliberately separates long, climate-consistent reanalysis from shorter operational forecast archives:

- ERA5 (1940+), ERA5-Land (1950+), ERA5-Ensemble (1940+), and CERRA use the [Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api).
- NOAA GFS, DWD ICON, and CMA GFS GRAPES use the separate [Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api): documented coverage starts 2021-03-23, 2022-11-24, and 2023-12-31 respectively. The first calendar year is partial; requests start on the documented date, and the panel labels these as archived forecasts rather than reanalysis.
- CERRA is Europe-only and its live archive currently ends 2021-06-30. The year-based analysis control therefore stops at 2020, the last complete calendar year.
- The 1991–2020 anomaly view is offered only when the selected source covers that whole baseline. For multi-decadal climate trends, keep the same reanalysis throughout rather than mixing forecast-model archives.

Open-Meteo documents key-free, non-commercial access subject to its published terms and usage limits. This app calls the official APIs directly; it does not use a public CORS proxy. See the [pricing and terms](https://open-meteo.com/en/pricing) before deployment, especially for commercial use.

### Cross-origin isolation

The weather-map-layer renders through `SharedArrayBuffer`, which needs cross-origin isolation. The dev and preview servers send the required `COOP`/`COEP` headers via a plugin in `vite.config.ts`; in production the same headers come from `static/_headers` (Cloudflare Pages). If these headers are ever dropped, the app still works but falls back to a slower path that copies data to every worker.

To serve the generated standalone HTML with those headers and gzip compression, run:

```bash
npm run serve:onefile -- ../open-meteo-maps-onefile.html
```

Then open `http://localhost:8000/`. Pass a different HTML path and optional port after `--` if needed. Use an HTTP server rather than `file://` so browser workers, external map data, and shared-memory isolation can work.

### Working on the weather-map-layer locally

`package.json` pins `@openmeteo/weather-map-layer` to a git commit. To develop against a local checkout, link it:

```bash
cd ../weather-map-layer && npm link && npm run build
cd ../maps && npm link @openmeteo/weather-map-layer
```

The package resolves through its `dist/` build, so rebuild the weather-map-layer after changes to see them in the app.

## Issues & Contributing

- Open issues and PRs in this repository for UI/demo-related changes.
- For issues with the weather map layer itself, see the [weather-map-layer issues](https://github.com/open-meteo/weather-map-layer/issues).
