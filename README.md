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

### Basemap

The map uses the first of these providers that loads; the others are automatic fallbacks:

1. **[Maptoolkit](https://www.maptoolkit.org) community vector tiles.** Free, no API key or sign-up. The app uses the English-labelled light and dark styles (`light-en` / `dark-en` on `styles.maptoolkit.org`); `VITE_MAPTOOLKIT_LANGUAGE=local` switches to Maptoolkit's own local-language labels.
2. **The Open-Meteo basemap style**, drawn from OpenFreeMap's tiles (the basemap this app used before Maptoolkit was added).
3. **OpenFreeMap's Positron / Dark style.**

**Failover.** Before Maptoolkit is used, the app fetches its style and TileJSON (6 s timeout) and checks them: a valid version 8 style, tiles served by Maptoolkit, every source layer the style reads, the copyright text, and a layer order the weather layers can be inserted into. If any check fails, the next provider is used. If Maptoolkit answers but then stops serving tiles (5 tile requests in a row fail and none succeeds for 4 s: an outage or a rate limit), the style is reloaded with the next provider. Missing tiles (404, which MapLibre treats as empty) and services that only fail now and then do not trigger it. A provider that failed is skipped for 10 minutes; a page reload tries all of them again. A toast tells the user when a fallback is in use. The code is in `src/lib/basemap.ts` (pure helpers, unit tested) and `src/lib/map-controls.ts`.

**Weather layer order.** Weather rasters go directly under the first administrative border of the Maptoolkit style, above every water, land and relief fill. (The "first line layer" rule of the other providers would put them under Maptoolkit's opaque water.) Contours and arrows go under the first label layer, and Clip Water adds copies of Maptoolkit's own water fills on top of them. Otherwise the style is used unchanged.

**Attribution.** Maptoolkit's terms (section 8) require its logo and the copyright line "© Maptoolkit © Openstreetmap" to be visible at every size and zoom, never collapsed, hidden or covered. With Maptoolkit active the map therefore shows the logo ([`@maptoolkit/maplibre-logo-control`](https://www.npmjs.com/package/@maptoolkit/maplibre-logo-control), 28 px high where the terms ask for at least 24, on a dark chip so it stays readable on pale maps) above a copyright line that is created with `compact: false`. `src/lib/attribution.ts` measures the time selector, the satellite panel and the replay bar and raises the credits above whichever is in the way; the historical panel and toasts stay clear of them too. The other providers keep MapLibre's normal collapsible attribution. Read section 8 again before changing any of this.

**Terms of use.** Maptoolkit's [terms of service](https://www.maptoolkit.org/tos) (Community License, version of 1 July 2026) allow its free tiles only for professional, non-commercial or academic use, open-source projects, and small commercial use (under EUR 1M revenue and fewer than 10 employees). They exclude consumer apps, bulk or offline use, screenshots in static documents, and using Maptoolkit styles with other tile providers. They also exclude use behind a login (intranets, paywalls) and any navigation, emergency or other safety-critical decision (section 14). Fair use is about 10 uncached requests per second sustained (50 in a burst) without registration; that is the figure in the binding terms, other Maptoolkit pages quote higher ones. There is no SLA, and endpoints can be discontinued with 90 days' notice. Browsers must call the Maptoolkit hosts directly (no proxy of your own); if you add a Content-Security-Policy, allow `styles`, `tiles`, `fonts` and `icons` on `maptoolkit.org` plus `tiles.mapterhorn.com`. Check that your project qualifies, and the current wording, before deploying.

| Variable                   | Default                             | Meaning                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_BASEMAP_PROVIDERS`   | `maptoolkit,open-meteo,openfreemap` | Order in which providers are tried. A shorter list switches the others off: `open-meteo,openfreemap` turns Maptoolkit off.                                                                                                                                                                                         |
| `VITE_MAPTOOLKIT_LANGUAGE` | `en`                                | Label language of the Maptoolkit basemap: `ar cs de en es fr hi hu it ja ko pl zh`, or `local` for Maptoolkit's own default (local names plus a Latin subtitle, so Bengali and English in Bangladesh). There is no Bengali-only variant, and MapLibre 6.11 draws Bengali letters unevenly, so `en` is the default. |

#### Open-Meteo style and browser CORS (providers 2 and 3)

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

Then open `http://localhost:8000/`. Pass a different HTML path and optional port after `--` if needed.

The standalone HTML also opens straight from disk (double-click, `file://`) in Chrome and Edge: there the workers are passed as `data:` URLs instead of `blob:` URLs, because a worker on a file page cannot load a nested `blob:` worker (see the comment in `scripts/build-onefile.mjs`). From disk there is no cross-origin isolation, so the app uses the slower path that copies data to every worker, and the first request to `data-spatial.open-meteo.com` is refused (HTTP 403) and retried through the S3 mirror. Use `npm run serve:onefile` or any HTTPS host with the headers above for the full-speed path.

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
