# Open-Meteo Maps — যাচাই ও হস্তান্তর প্রতিবেদন

**যাচাইয়ের তারিখ:** ১ অক্টোবর ২০২৬ (Asia/Dhaka)  
**Standalone HTML:** `/home/user/open-meteo-maps-onefile.html`  
**লাইভ সার্ভার:** `open-meteo-maps-886565a0`, পোর্ট `8000`; `serve:onefile` COOP/COEP হেডারসহ চালু।  
**প্রধান browser log:** `/home/user/screenshots/final-browser-log-archive-audit.json` এবং `/home/user/screenshots/final-browser-log-satellite.json`

## সারাংশ

Standalone Maps HTML পুনর্নির্মাণ করে Chromium-এ যাচাই করা হয়েছে। ERA5 ও CERRA reanalysis এবং GFS historical forecast—তিনটি স্বতন্ত্র view-তে historical panel এবং data-র তারিখসীমা মিলিয়ে দেখা হয়েছে। Historical Forecast (GFS, ICON, CMA GRAPES) আলাদা forecast archive হিসেবেই রাখা হয়েছে; এটিকে Historical Weather reanalysis বা climate observation বলে দেখানো হয় না। প্রথম আংশিক forecast বছরের অনুরোধ নথিভুক্ত প্রথম-উপলভ্য তারিখ থেকেই শুরু হয়।

একই timeline-এ satellite browse চালু থাকে; আলাদা satellite button যোগ করা হয়নি। One-file build-এ app code, worker/WASM assets অন্তর্ভুক্ত, তবে মানচিত্র, আবহাওয়া, archive এবং satellite data network থেকে আসে—এটি offline data bundle নয়। কোনো public CORS proxy ব্যবহার করা হয়নি।

## যাচাইয়ের ফল

| ক্ষেত্র                 | ফল                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run check`         | সফল; ০ error, ০ warning                                                                                      |
| `npm test -- --run`     | ১২টি test file-এ ২৪৯টি test পাস                                                                              |
| `npm run lint`          | সফল                                                                                                          |
| `npm run build:onefile` | সফল; HTML প্রায় ৫.৬৭ MiB, gzip প্রায় ১.১১ MiB                                                                |
| Standalone browser run  | HTTP ২০০; COOP/COEP-সহ `crossOriginIsolated: true`                                                           |
| Basemap                 | Open-Meteo style-এর প্রয়োজনীয় layer OpenFreeMap vector tiles দিয়ে এসেছে; attribution দৃশ্যমান                |
| CORS                    | পরীক্ষিত OpenFreeMap tile, Open-Meteo historical API এবং NASA GIBS response-এ wildcard CORS header দেখা গেছে |
| Historical data         | Dhaka ERA5 ও GFS এবং Europe-এর CERRA live data দিয়ে যাচাই                                                    |
| Satellite               | NASA GIBS metadata/imagery tile HTTP ২০০; কোনো console error বা failed request রেকর্ড হয়নি                   |

## Historical data: source, coverage ও live verification

দুটি Open-Meteo API-কে UI-তে আলাদা রাখা হয়েছে: Historical Weather API-র reanalysis archive এবং Historical Forecast API-র operational NWP forecast archive। নিচের “live পরীক্ষা” কলামে শুধু এই যাচাইয়ে সরাসরি আনা series-এর ফল আছে; বাকিগুলোর তারিখ selector metadata ও unit test-এ যাচাই করা হয়েছে।

| UI-তে source   | ডেটার ধরন ও নথিভুক্ত coverage                               | যাচাইয়ের ফল / আচরণ                                                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ERA5           | Reanalysis; ১৯৪০ থেকে                                       | Dhaka-র কাছে `1980–2025`, `daily=temperature_2m_mean`: ১৬,৮০২/১৬,৮০২ দৈনিক মান। API grid cell `23.750°N, 90.500°E`, elevation ১২ m।                                                                                            |
| ERA5-Land      | Reanalysis; ১৯৫০ থেকে                                       | Source metadata; এই পাসে আলাদা live series টানা হয়নি।                                                                                                                                                                          |
| ERA5 Ensemble  | Reanalysis; ১৯৪০ থেকে                                       | Source metadata; এই পাসে আলাদা live series টানা হয়নি।                                                                                                                                                                          |
| CERRA          | Europe-only reanalysis; ১৯৮৫ থেকে, archive শেষ `2021-06-30` | `49.983°N, 10.000°E`, `1985–2020`: ১৩,১৪৮/১৩,১৪৯ দৈনিক মান; একটি missing value বাদ গেছে। Year control ২০২০-তে থামে—এটি শেষ পূর্ণ calendar year। Dhaka-র বাইরে হওয়ায় CERRA API HTTP ৪০০ দেয়; UI-তে Europe-only সীমা জানানো আছে। |
| NOAA GFS       | Historical forecast; `2021-03-23` থেকে                      | Dhaka grid cell-এ `2021-03-23–2025-12-31`: ১,৭৪৫/১,৭৪৫ দৈনিক মান। ২০২১ আংশিক বছর; request সঠিকভাবে ২৩ মার্চ থেকে শুরু। ১৯৯১–২০২০ পূর্ণ normal নেই, তাই anomaly view দেখানো হয় না।                                              |
| DWD ICON       | Historical forecast; `2022-11-24` থেকে                      | সঠিক first-available date selector/request bound ও unit test-এ যাচাই; এই পাসে আলাদা full live series টানা হয়নি।                                                                                                                |
| CMA GFS GRAPES | Historical forecast; `2023-12-31` থেকে                      | সঠিক first-available date selector/request bound ও unit test-এ যাচাই; এই পাসে আলাদা full live series টানা হয়নি।                                                                                                                |

**Coverage কীভাবে প্রয়োগ হয়:** partial first year-এর request documented first-available date দিয়ে clamp হয়—GFS `2021-03-23`, ICON `2022-11-24`, GRAPES `2023-12-31`; এগুলোর জন্য আলাদা `archiveStartDate()` logic ও test আছে। নতুন source-এর সঙ্গে নির্বাচিত সময়সীমার overlap না থাকলে panel অনুপযুক্ত ফাঁকা range ধরে রাখে না—নতুন source-এর পূর্ণ উপলভ্য সীমায় যায়। CERRA-র মাঝবছরের শেষ তারিখের কারণে পূর্ণ-বছরের selector ২০২০-তেই থামে।

**Anomaly ও annual comparison:** 1991–2020 normal কেবল যে source-এ পুরো baseline পাওয়া যায়, সেখানেই সক্রিয়। ERA5 anomaly request HTTP ২০০ পেয়েছে এবং chart সম্পূর্ণ হয়েছে। Historical Forecast-এর ছোট archive দিয়ে ওই baseline বানানোর ভান করা হয় না। Annual comparison-এর generic label `Last − first third`; এটি শেষ ও প্রথম তৃতীয়াংশের পার্থক্য, কোনো নিশ্চিত একমুখী “warming” দাবি নয়। ঋণাত্মক মানের sign-ও ঠিকভাবে দেখায়। দীর্ঘ archive view-তে daily aggregation ব্যবহৃত হয়—অপ্রয়োজনীয় কয়েক লাখ hourly point টানা হয় না।

### API, শর্ত ও বিকল্প no-key data

- Open-Meteo Historical Weather API: [official documentation](https://open-meteo.com/en/docs/historical-weather-api)। Historical Forecast API: [official documentation](https://open-meteo.com/en/docs/historical-forecast-api)। Forecast archive-এর data-কে reanalysis হিসেবে ব্যাখ্যা করা যাবে না।
- Open-Meteo-র key-free access ও ব্যবহারের শর্ত/সীমা endpoint ও ব্যবহারের ধরনভেদে প্রযোজ্য। Free access-কে commercial-use অনুমতি বা SLA হিসেবে ধরে নেওয়া হয়নি; deployment-এর আগে [pricing/terms](https://open-meteo.com/en/pricing) যাচাই করুন।
- **NASA POWER Daily API** আরেকটি সম্ভাব্য no-key দৈনিক meteorology/solar source—এটি এই app-এ যুক্ত নয়। ১ অক্টোবর ২০২৬-এ API-তে API key ছাড়া, `Origin: https://maps-test.example` দিয়ে অনুরোধ পাঠালে HTTP ২০০, `Access-Control-Allow-Origin: *` এবং `sources: MERRA2, POWER` পাওয়া গেছে। পুনরুৎপাদনযোগ্য পরীক্ষা: [১৯৮১-০১-০১ থেকে ০৩ জানুয়ারির Dhaka JSON request](https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M%2CT2M_MAX%2CT2M_MIN%2CPRECTOTCORR&community=RE&longitude=90.41&latitude=23.81&start=19810101&end=19810103&format=JSON&time-standard=UTC)। Official [Daily API docs](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) অনুযায়ী দৈনিক UTC/LST series ১৯৮১-০১-০১ থেকে near-real-time পর্যন্ত; meteorology মূলত MERRA-2-এর প্রায় ০.৫° × ০.৬২৫° grid। এটি ERA5 বা station observation-এর সমতুল্য/প্রতিস্থাপন নয়; সময়-মান (UTC বনাম local solar time), grid ও parameter definition খেয়াল করতে হবে।
- NOAA/NCEI station observations-এর ক্ষেত্রে API-গুলো আলাদা করে বুঝতে হবে: পুরোনো CDO v2 endpoint token চায়, কিন্তু পৃথক NCEI Search Service ও Access Data Service key/token ছাড়া live test-এ HTTP ২০০ এবং `Access-Control-Allow-Origin: *` দিয়েছে। Dhaka bbox-তে GHCN-Daily station `BGM00041923` (Tejgaon) পাওয়া গেছে; তবে series অসম্পূর্ণ এবং latest sample ২০২৫-০৮-২৪-এ শেষ।
- এই research pass-এ নতুন করে NOAA **GHCNh hourly**, **LCD v2**, **SSOD v2 daily**, **GHCN-M v4 QCF monthly**, legacy GSOD/GSOM ও Meteostat যাচাই করা হয়েছে। GHCNh, LCDv2 ও SSOD Search/Data GET no-key-তে CORS header দিয়েছে; তবে LCDv2 Dhaka test-এ daily summary field আসেনি এবং precipitation sparse; GHCNh-এ transient empty/503 response, SSOD-এ Dhaka-র ১৯৬৪–১৯৭২ gap ও `-9999.9` sentinel আছে। GSOD ২০২৫-০৮-২৯-এ end-of-life; GHCN-M selective byte-range extraction promising হলেও fixed-record format ধরে experimental, Chromium-এ যাচাই হয়নি; Meteostat history-তে provider/model forecast mix হতে পারে। **এই উৎসগুলো Maps app-এ integrate করা হয়নি**—verification report app code/browser result আগের scope-এই রাখে। Query, coverage, licenses/terms, CORS ও implementation caveat বিস্তারিত `historical-data-research-bn.md`-এ আছে.

## Basemap ও CORS-এর endpoint প্রমাণ

CORS যাচাইয়ে প্রকৃত endpoint request/response এবং browser resource log দেখা হয়েছে। Wildcard header কেবল পরীক্ষিত anonymous GET response-এর পর্যবেক্ষণ; এটি ভবিষ্যৎ availability, credentialed request বা rate-limit-এর নিশ্চয়তা নয়।

| Resource                                             | HTTP | `Access-Control-Allow-Origin` | ফল                                                        |
| ---------------------------------------------------- | ---: | ----------------------------- | --------------------------------------------------------- |
| Open-Meteo light/dark style JSON                     |  ২০০ | `*`                           | Style JSON browser-এ পড়া যায়                              |
| মূল `tiles.open-meteo.com/planet_minimal.json`       |  ২০০ | অনুপস্থিত                     | TileJSON সরাসরি browser fetch-এর উপযোগী নয়                |
| মূল Open-Meteo vector MVT                            |  ২০০ | অনুপস্থিত                     | Browser CORS বাধা এড়াতে এই vector source ব্যবহার করা হয়নি |
| `https://tiles.openfreemap.org/planet` TileJSON      |  ২০০ | `*`                           | CORS-সক্ষম; প্রয়োজনীয় source layer পাওয়া গেছে             |
| OpenFreeMap vector MVT `.pbf`                        |  ২০০ | `*`                           | Browser-এ সরাসরি tile render হয়েছে                        |
| OpenFreeMap Positron ও Dark fallback style           |  ২০০ | `*`                           | দুটিই browser-এ পরীক্ষা করা হয়েছে                         |
| Glyph PBF, sprite JSON/PNG, Natural Earth raster PNG |  ২০০ | `*`                           | Fallback-এর subresource-ও যাচাই করা হয়েছে                 |

OpenFreeMap TileJSON-এ Open-Meteo style-এর প্রয়োজনীয় `boundary`, `place`, `transportation`, `water`, `waterway` layer আছে। App TileJSON inline করে; runtime-এ আলাদা TileJSON lookup লাগে না। Attribution-এ OpenFreeMap, OpenMapTiles ও OpenStreetMap রাখা হয়েছে। OpenFreeMap-এর [service page](https://openfreemap.org/) public service-এর attribution ও key-বিহীন ব্যবহারের কথা জানায়; [Quick Start](https://openfreemap.org/quick_start/) সরাসরি MapLibre integration দেখায়। কোনো public CORS proxy যোগ করা হয়নি।

## বাইরের origin ও S3 fallback

Sandbox-এর আসল preview URL সরাসরি fetch করলে platform-এর traffic-access-token gate HTTP ৪০৩ দিয়েছে; ওই proxy URL-এ সরাসরি app request যাচাই সম্ভব হয়নি। তাই Chromium-এ `preview.test:8000` নামে আলাদা বাইরের-origin simulation চালানো হয়েছে—app server-এ resolve করিয়ে browser origin/Referer আলাদা রেখে। এটি অনুমোদিত `localhost` referer নয়, তাই data endpoint-এর access policy কার্যকর হয়েছে:

- `data-spatial.open-meteo.com`-এর `latest.json` ও `in-progress.json` HTTP ৪০৩ দিয়েছে; response-এ browser-পাঠযোগ্য CORS header ছিল।
- App ৪০৩ শনাক্ত করে public S3 mirror-এ retry করেছে; দুই metadata JSON-ই HTTP ২০০ এসেছে।
- OM file metadata-র ranged GET `206 Partial Content`, `Content-Range: bytes 0-0/172097040`; পরবর্তী block-range request-ও ২০৬ পেয়েছে।
- JavaScript exception/page error হয়নি; fallback-এর পর প্রত্যাশিতভাবে আগের ৪০৩ request cancel হয়েছে।

অতএব, বাইরের-host denial → S3 retry flow বাস্তব endpoint-এ যাচাই হয়েছে, কিন্তু platform token-সুরক্ষিত preview hostname-এ সরাসরি নয়—উপরের আলাদা-origin simulation-এ।

## NASA GIBS satellite browse

Forecast range-এর সাত দিনেরও পেছনের `2026-09-20` তারিখ unified timeline-এ বেছে browse mode পরীক্ষা করা হয়েছে। UI সময়কে `2026-09-20T1200`-এ normalize করে এবং Terra/MODIS corrected-reflectance true-colour, ২৫০ m daily imagery দেখিয়েছে। GIBS metadata ও imagery tile request HTTP ২০০ এবং wildcard CORS-সহ এসেছে; পরীক্ষিত session-এ console error বা failed request ছিল না। UI-তে GIBS coverage `2000-02-24` থেকে `2026-10-01` দেখিয়েছে এবং ১০টি gap চিহ্নিত করেছে। Screenshot-এ কালো swath/no-data অংশ দৃশ্যমান—এগুলো coverage gap/imagery footprint, network failure নয়। `Forecast` flow timeline-এ ফেরায়; আলাদা satellite toolbar button নেই। NASA GIBS সম্পর্কে [official API docs](https://nasa-gibs.github.io/gibs-api-docs/) দেখুন।

## এই পাসে করা/যাচাই করা code পরিবর্তন

1. `src/lib/map-controls.ts`: typed MapLibre style/source/layer/TileJSON; style version 8 validation; provider attribution ও required source-layer যাচাই; CORS-সক্ষম OpenFreeMap source এবং Positron/Dark fallback।
2. `src/lib/gibs-layers.ts`: `map.isStyleLoaded()` visible source tile শেষ হওয়া পর্যন্ত false থাকতে পারত, ফলে satellite tile pump শুরু হতো না। Parsed style layer list প্রস্তুত কি না দেখে GIBS tile request শুরু করার ব্যবস্থা করা হয়েছে।
3. `src/lib/stores/archive.ts`: Historical Forecast-এর পৃথক endpoint routing, documented source bounds এবং প্রথম partial বছরের exact start date (`archiveStartDate()`)।
4. `src/lib/components/history/historical-panel.svelte`: source-specific year bounds/domain note, পূর্ণ 1991–2020 baseline ছাড়া anomaly বন্ধ, no-overlap source switch-এ সঠিক date range, generic `Last − first third` label এবং negative-value formatting। Longitude hemisphere-ও ঠিক করা হয়েছে।
5. `src/lib/tests/archive-models.test.ts`: GFS, ICON ও CMA GRAPES-এর exact first-available date এবং disjoint-period source switching-সহ archive coverage test।
6. `src/lib/url.ts`: পুরোনো fragment-এর পরে MapLibre hash আবার জুড়ে `#zoom/lat/lon` duplicate হওয়ার সমস্যা ঠিক করা হয়েছে।
7. `README.md`: reanalysis বনাম forecast archive, coverage caveat, OpenFreeMap CORS/attribution, standalone serving ও 403→S3 fallback নথিভুক্ত।

## Screenshots ও logs

সর্বশেষ screenshots `/home/user/screenshots/`-এ:

- [ERA5 — Dhaka, historical analysis](../screenshots/final-08-historical-era5-dhaka.png)
- [CERRA — Europe, historical analysis](../screenshots/final-09-historical-cerra-europe.png)
- [GFS — Historical Forecast](../screenshots/final-10-historical-gfs-forecast.png)
- [Standalone default map](../screenshots/final-11-standalone-map.png)
- [NASA GIBS satellite browse](../screenshots/final-12-satellite-browse.png)

সম্পর্কিত request/response record:

- Archive, historical data, basemap এবং CORS: `../screenshots/final-browser-log-archive-audit.json`
- NASA GIBS satellite browse: `../screenshots/final-browser-log-satellite.json`

## সীমাবদ্ধতা ও পরবর্তী সতর্কতা

- OpenFreeMap, Open-Meteo এবং NASA GIBS—সবই বাহ্যিক service; endpoint, CORS header, quota বা availability বদলাতে পারে। Attribution ও service terms মেনে চলুন; key-free access-কে commercial permission বা SLA ধরে নেবেন না।
- Historical Weather reanalysis হলো model/data-assimilation product—station observation নয়। Historical Forecast হলো operational forecast archive—climate-consistent reanalysis নয়। দীর্ঘ climate trend-এ একই reanalysis source ধরে রাখুন; মডেল বদলালে series জোড়া লাগানো যাবে না।
- CERRA Europe-এ সীমাবদ্ধ; Dhaka-র জন্য ব্যবহারযোগ্য নয়। CERRA-র শেষ archive date ২০২১-০৬-৩০, কিন্তু UI পূর্ণ বছরের বিশ্লেষণেই সীমাবদ্ধ।
- `npm ci`-তে Node `v20.20.2`-এ Vitest 5 এবং কিছু dependency-র জন্য Node 22+ engine warning দেখা গিয়েছিল; ১২টি audit finding-ও ছিল। এই পাসে dependency upgrade/audit fix করা হয়নি। Node LTS/CI compatibility ও advisories আলাদা করে পর্যালোচনা করুন।
- Standalone build-এর size নথিভুক্ত; আলাদা performance benchmark বা unsupported speed claim করা হয়নি। Browser screenshots/logs live integration check—সব model/variable/location combination-এর পূর্ণাঙ্গ coverage test করার দাবি নয়।
