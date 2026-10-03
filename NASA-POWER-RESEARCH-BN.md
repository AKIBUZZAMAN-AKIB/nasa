# NASA POWER API গবেষণা ও integration audit

**লাইভ যাচাইয়ের তারিখ:** ৩ অক্টোবর ২০২৬ (Asia/Dhaka)

**প্রকল্প:** Open-Meteo Maps — NASA POWER explorer

## সারাংশ

NASA POWER REST API-র Temporal, Application ও System পরিবারকে Open-Meteo Maps-এ একটি পৃথক map control/panel হিসেবে যুক্ত করা হয়েছে। Parameter catalog, format, community ও endpoint configuration NASA-র live Manager/Configuration/OpenAPI endpoint থেকে নেওয়া হয়; OpenAPI-র `format` `$ref`-ও resolve করা হয়। অর্থাৎ OpenAPI-তে enum থাকলেই form-এ দেখানো হয় না—live configuration ও live request validation-এর সঙ্গে সামঞ্জস্য রাখা হয়েছে।

NASA POWER-এর সরাসরি endpoint `https://power.larc.nasa.gov/api/...`; API key/auth token লাগেনি। Browser `Origin` header দিয়ে Temporal config, Manager parameter list ও Application config probe-এ HTTP 200 এবং `Access-Control-Allow-Origin: *` পাওয়া গেছে; তাই UI সরাসরি NASA-র API-তে fetch করে। ডেটা gridded satellite/reanalysis-ভিত্তিক estimate, station-এর in-situ observation নয়। NASA-র service guide meteorological data-র জন্য 0.5° × 0.625° এবং solar parameter-এর জন্য 1° × 1° resolution জানায়; coordinate precision-কে native data resolution-এর সমতুল্য ধরা হয়নি। Near-real-time source পরে climate-quality update দিয়ে supersede হতে পারে; source availability-কে প্রতিটি parameter-এর completeness guarantee হিসেবে দেখানো হয়নি।

## Request rate, resolution ও response-time guidance

NASA API overview HTTP 429-কে `Too Many Requests` হিসেবে নথিভুক্ত করে। NASA-র synchronous-request tutorial অতিরিক্ত request-এ server performance ক্ষতিগ্রস্ত হলে access block হতে পারে বলে সতর্ক করে; tutorial-এর multiprocessing code example-এ সর্বোচ্চ পাঁচটি concurrent request-এর মন্তব্য আছে। এটিকে উদাহরণভিত্তিক guidance হিসেবে ধরা হয়েছে, hard service quota হিসেবে নয়। পর্যালোচিত NASA docs-এ fixed per-minute request quota প্রকাশিত নেই—তাই UI-তে কোনো অযাচাইকৃত RPM limit বা client-side throttle বানানো হয়নি। Explorer user-triggered request করে, স্বয়ংক্রিয় grid-wide/high-concurrency batch চালায় না; bulk download-এর জন্য আলাদা NASA POWER AWS archive link আছে। Server error response এলে HTTP status ও NASA message দেখানো হয়; browser/network/CORS failure-এ status নাও পাওয়া যেতে পারে। Automatic retry করা হয় না।

একই NASA tutorial data product-এর native resolution-এর চেয়ে সূক্ষ্ম sampling না করতে বলে—meteorology-র জন্য 0.5° × 0.625°, solar parameter-এর জন্য 1° × 1°—কারণ সূক্ষ্ম repeated request একই source information আবার আনতে পারে। এটি API-র grid-cell/location behavior ব্যাখ্যা করে; Regional API-র আলাদা minimum bounding-box span (এই integration-এ 2°) এর সঙ্গে গুলিয়ে ফেলা যাবে না। NASA আরও বলে 2–3 মাস real time-এর পর improved climate-quality meteorological product দিয়ে data প্রতিস্থাপিত হতে পারে। Response time service, load, temporal granularity ও parameter count অনুযায়ী বদলায়; docs-এ Application API সাধারণত এক মিনিটের কমে শেষ হওয়ার কথা বলা হয়েছে, guarantee নয়।

## API coverage

| API পরিবার         | যুক্ত করা endpoint/functionality                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporal           | Hourly, Daily, Monthly/Annual, Climatology; যেখানে NASA endpoint দেয় সেখানে Point ও Regional; live formats, parameter catalog, community, metric/imperial, LST/UTC, header, optional `user`, site elevation, wind elevation/surface |
| Application        | Climate Indicators; Windrose JSON/CSV/ASCII ও পৃথক official HTML `/plot`; Thermal/Thermal-Moisture Zones Point/Regional/Global                                                                                                      |
| System — Manager   | community/temporal-ভিত্তিক parameter listing, parameter detail, all-surface catalog ও individual `/surface/{alias}` detail, Data Access Viewer groupings                                                                            |
| System — Resources | source-availability dashboard ও documented content endpoint; stale docs examples-কে live functionality হিসেবে দাবি করা হয়নি                                                                                                         |
| ArcGIS / AWS       | POWER-এর documented ArcGIS image/feature service এবং NASA POWER S3 ARD/DDD/SDS bucket index link; unverified service-কে map overlay হিসেবে সক্রিয় করা হয়নি                                                                          |

### Live OpenAPI endpoint inventory (৩ অক্টোবর ২০২৬)

NASA-র ৯টি live OpenAPI JSON document-ই HTTP 200 দিয়েছে। প্রতিটি document-এর path inventory এবং panel-এ সংশ্লিষ্ট function মিলিয়ে দেখা হয়েছে:

- **Temporal:** Hourly — `/point`, `/configuration`; Daily, Monthly, Climatology — `/point`, `/regional`, `/configuration`। Hourly Regional path নেই।
- **Application:** Indicators — `/point`, `/configuration`; Windrose — `/point`, `/plot`, `/configuration`; Zones — `/point`, `/regional`, `/global`, `/configuration`।
- **System / Manager:** `/parameters`, `/parameters/{parameter}`, `/surface`, `/surface/{alias}`, `/system/groupings`, `/configuration`।
- **System / Resources:** `/content`, `/dashboard/availability`, `/configuration`।

এই inventory অনুযায়ী Manager-এর single-surface endpoint-ও UI-তে alias ধরে request ও response দেখানোর জন্য যুক্ত হয়েছে। Resources docs-এ থাকা metrics/dashboard/plots উদাহরণ live OpenAPI path নয়; direct probe-ও নিচে নথিভুক্ত।

### Live configuration snapshot ও coverage guard

৩ অক্টোবর ২০২৬-এর live configuration-এ service range ছিল:

| Service                    | Live coverage (`settings.start`–`settings.end`) | Version |
| -------------------------- | ----------------------------------------------- | ------- |
| Hourly                     | 2001-01-01 – 2026-10-03                         | v2.10.2 |
| Daily                      | 1981-01-01 – 2026-10-03                         | v2.10.0 |
| Monthly                    | 1981-01-01 – 2026-10-31                         | v2.10.0 |
| Climatology custom periods | 1981-01-01 – 2025-12-31                         | v2.10.0 |
| Indicators                 | 2001-01-01 – 2025-12-31 (`range=5`)             | v2.9.2  |
| Windrose                   | 1981-01-01 – 2026-10-03                         | v2.9.1  |
| Zones                      | 1981-01-01 – 2025-12-31                         | v2.9.1  |

Form-এর date/year `min`/`max` এবং request validation এই bounds-কে live configuration থেকে নেয়; স্থায়ী future-year limit বসানো হয়নি। এটি জরুরি, কারণ Hourly/Daily-তে coverage-এর পরে query করলে NASA কখনও HTTP 200 দিলেও খালি বা আংশিক data দেয় এবং response header-এ end date নিজে clamp করে। যেমন Daily 2026-09-30–2026-10-10 query HTTP 200 হলেও header end ছিল 2026-10-03; 2027-01-01–07 query HTTP 200 হলেও `T2M` series খালি ছিল।

### Temporal API-র নির্ভুলতা

- Hourly endpoint Point-এ সীমিত; NASA-র live API contract-এ Hourly Regional নেই।
- Live Temporal Configuration-এ বর্তমানে `AG`, `RE`, `SB` এসেছে। OpenAPI-তে `HY` enum থাকলেও live `HY` request HTTP 422 দিয়েছে; তাই UI-তে `HY` দেখানো হয়নি। Community options live config থেকে আসে।
- Formats live OpenAPI endpoint/path থেকে resolve হয়। Regional path-এর format list আলাদা হলে Regional schema-ই ব্যবহৃত হয়। Daily `ICASA` শুধু `AG` community-তে এবং Hourly `EPW`/`EPW_CSV` শুধু `SB`-তে রাখা হয়েছে।
- Client validation: Hourly Point-এ সর্বোচ্চ ১৫ parameter; অন্য Temporal Point-এ ২০; Regional-এ ১। Regional request-এ latitude ও longitude—দুটির span-ই কমপক্ষে ২° হতে হবে; এর কম হলে Point ব্যবহার করতে বলা হয়।
- Hourly/Daily date ও Monthly/Custom Climatology year live configuration range-এর বাইরে হলে request বন্ধ থাকে। API-এর config update হলে input bounds-ও বদলায়। Custom Climatology-র জন্য কমপক্ষে দুই বছরের span দরকার; 2024–2025 HTTP 200, কিন্তু 2024–2024 HTTP 422 দিয়েছে। Precomputed normal বেছে নিলে `start`/`end` বাদ দেওয়া হয়।
- Hourly guide EPW-এর জন্য 2000-01-01 থেকে শুরু হওয়ার কথা বললেও বর্তমান configuration-এর শুরু 2001-01-01; `community=SB`, EPW ও start=2000 probe-এ HTTP 422 দিয়ে start 2001 চাওয়া হয়েছে। UI live API-র 2001 সীমাটিই ব্যবহার করে।
- Monthly response-এর `YYYY13` annual aggregate-কে আলাদা annual value হিসেবে দেখানো হয়—এটি ১৩তম calendar month নয়। Climatology-তে `JAN`–`DEC` মাস-ক্রমে chart হয় এবং `ANN` আলাদা annual normal হিসেবে দেখানো হয়।
- Regional map layer-এ NASA ফেরত দেওয়া grid-cell centre point ব্যবহার হয়; এগুলোকে interpolated/pixel-resolution raster হিসেবে উপস্থাপন করা হয়নি। NASA response-এ feature geometry coordinates/elevation ও parameter values থাকে। Map overlay হলো value-coloured sample-point circles, নির্বাচিত period/parameter-এর min–max legend-সহ।
- LST হলো local solar-time convention, civil timezone নয়। Hourly, Daily, Monthly ও Climatology—সব Temporal service-এর live OpenAPI-তে `time-standard` আছে; UI-তেও LST/UTC নির্বাচন আছে এবং response metadata দেখানো হয়।
- Wind elevation-এর সীমা ১০–৩০০ মিটার; custom wind surface-এর জন্য wind elevation বাধ্যতামূলক। Surface alias Manager endpoint থেকে আসে।
- Live Hourly configuration-এ `SAM`, `SRW` ও `XARRAY`-ও আছে, যদিও human-readable Hourly format table-এ SAM/SRW নেই। Probe-এ **SAM** fixed-column CSV ফেরত দিয়েছে (selected parameter বদলালেও schema একই; `units`/`time-standard` query বদলালে ওই output বদলায়নি)। **SRW**-তে start অবশ্যই জানুয়ারি ১ এবং end ডিসেম্বর ৩১ হতে হয়; আংশিক বছর HTTP 422, পূর্ণ ২০২৫ calendar year AG, RE ও SB—তিন community-তেই HTTP 200। RE community-র SRW probe-এ `time-standard` উপেক্ষা করে UTC ফেরে; `units=imperial` দিলে numeric values বদলায়, কিন্তু units row-তে Celsius/m/s-ই থাকে। তাই UI fixed-schema caveat দেখায়, SAM/SRW-তে units/time controls লুকায়, এবং ভুল label এড়াতে SRW request থেকে `units` বাদ দিয়ে metric output নেয়।

### Application API-র নির্ভুলতা

- **Indicators:** single-point API; পাঁচ বছরের কম range client validation-এ আটকে দেওয়া হয়। Live 2001–2005 request সফল হয়েছে। Response-এ top-level indicator-code values ও `metadata` থাকে; UI unit category NASA metadata-র মতো দেখায়, per-code unit অনুমান করে না। Docs-এ 1990–2014 preprocessed window-এর উল্লেখ থাকলেও বর্তমান live config start 2001; 1990–2014 direct probe HTTP 422-এ `data starts at 2001` জানিয়েছে। UI তাই live সীমাই মানে।
- **Windrose:** point data endpoint ও interactive HTML plot আলাদা resource। UI 10 m (`WR10M`) ও 50 m (`WR50M`), ১৬টি direction sector এবং response metadata-তে পাওয়া speed-bin labels দেখায়। Legend live JSON `messages`-এর class definitions থেকে তৈরি হয়; class text hard-code করে response-কে প্রতিস্থাপন করা হয় না। HTML plot-এর theme-ও নির্বাচন করা যায়।
- **Zones:** Point JSON/NetCDF; Regional/Global NetCDF—format live configuration থেকে। কমপক্ষে দুই বছরের time span validation আছে। Regional endpoint-এ latitude ও longitude—দুটির span কমপক্ষে ৫°; Temporal API-র ২° নিয়ম এখানে প্রযোজ্য নয়। Live 1984–1985 Point JSON, ৫° Regional NetCDF ও Global NetCDF probe সফল হয়েছে। Moisture subtype numeric code (NASA-র উদাহরণ `3A=31`, `3B=32`) থাকলে code-ই দেখানো হয়, অনুমান করে label বানানো হয় না।

### System API ও আলাদা delivery service

- Manager parameter listing-এ code, name, definition, units/source metadata; full profile detail endpoint থেকে। `metadata=true` extended response probe-ও HTTP 200 দিয়েছে।
- Manager surfaces (`/api/system/manager/surface`), individual alias detail (`/api/system/manager/surface/vegtype_1`, `/vegtype_10`) ও groupings (`/api/system/manager/system/groupings`) live HTTP 200 দিয়েছে; invalid `vegtype_999` alias HTTP 422 দিয়েছে। UI all-alias list-এর পাশাপাশি নির্দিষ্ট alias detail call-ও দেখায়।
- Resources availability (`/api/system/resources/dashboard/availability`) live HTTP 200; এতে source-level latest date, available count ও latency থাকে।
- Resources content (`/api/system/resources/content?name=dashboard-sources`) এই audit-এ HTTP 500 দিয়েছে। Origin header-সহ ওই error response-এ `Access-Control-Allow-Origin` ছিল না; তাই browser-এ NASA-র error JSON না-ও পৌঁছাতে পারে, generic fetch/CORS error-ও হতে পারে।
- Resources guide-এ `/metrics/tabular`, `/dashboard?name=Availability` ও `/dashboard/plots?name=user_normal` উদাহরণ আছে, কিন্তু এগুলো live Resources OpenAPI-তে নেই; ৩ অক্টোবরের direct probe-এ তিনটিই website HTML-সহ HTTP 404 দিয়েছে। তাই UI-তে এগুলো কার্যকর endpoint হিসেবে যোগ করা হয়নি; guide/OpenAPI অমিল স্পষ্ট করে দেখানো হয়েছে।
- NASA docs-এ তালিকাভুক্ত POWER ArcGIS service URLs এই audit-এ HTTP 404 দিয়েছে। তাই official service/item link দেখানো হয়েছে, কিন্তু unverified URL স্বয়ংক্রিয়ভাবে map-এ যোগ করা হয়নি।
- NASA AWS docs POWER ARD Zarr-কে direct online access-এর জন্য এবং NetCDF/CRF bulk datastore-কে পৃথক access pattern হিসেবে বর্ণনা করে। UI bucket index-এ নিয়ে যায়; raw bulk data-কে REST API-র community/unit-converted ফল বলে দাবি করে না।

## Live API smoke-test ফল

| Probe                                                                                                        | ফলাফল                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Hourly Point, Daily Point, Monthly Point, Climatology Point                                                  | HTTP 200                                                                                                |
| Daily Regional, 2° × 2°, JSON                                                                                | HTTP 200; probe bbox-এ ১৫টি GeoJSON feature                                                             |
| Regional 2°-এর কম                                                                                            | Temporal Daily/Monthly/Climatology-তে HTTP 422; NASA minimum span নিশ্চিত করে                           |
| Indicators Point, 2001–2005                                                                                  | HTTP 200                                                                                                |
| Windrose Point, 2010–2014 (`YYYYMMDD`)                                                                       | HTTP 200; `WR10M`, `WR50M`, live class metadata                                                         |
| Windrose `/plot`, HTML                                                                                       | HTTP 200; পৃথক HTML response                                                                            |
| Zones Point, 1984–1985                                                                                       | HTTP 200                                                                                                |
| Zones Regional, 5° × 5°, NetCDF                                                                              | HTTP 200; `application/x-netcdf`                                                                        |
| Zones Regional, 5°-এর কম / JSON                                                                              | HTTP 422; minimum 5° ও Regional NetCDF সীমা যাচাই                                                       |
| Zones Global, 1984–1985, NetCDF                                                                              | HTTP 200; `application/x-netcdf`                                                                        |
| Climatology custom 2024–2025 / এক-বছরের 2024–2024                                                            | HTTP 200 / HTTP 422; minimum two-year range                                                             |
| Daily 2027 future / 2026-09-30–2026-10-10                                                                    | HTTP 200 হলেও খালি / partial; API end 2026-10-03-এ clamp করে                                            |
| Monthly 2026 / 2027 পর্যন্ত                                                                                  | HTTP 200 (2026-10-31 পর্যন্ত) / HTTP 422                                                                |
| Hourly EPW start 2000; Indicators 1990–2014                                                                  | উভয়ই HTTP 422; live minimum 2001                                                                        |
| SRW full calendar year 2025 (AG/RE/SB) / partial-year start/end                                              | তিন community-তেই HTTP 200 / partial year-এ HTTP 422; Jan 1–Dec 31 বাধ্যতামূলক                          |
| SAM/SRW fixed-format parameter, units ও time-standard probes                                                 | SAM fixed CSV/LT; SRW fixed wind file/UTC; SRW imperial values বদলায় কিন্তু response units row metric-ই |
| ৯টি live OpenAPI document; Manager parameters/detail/surface/surface-alias/groupings; Resources availability | HTTP 200                                                                                                |
| Resources guide-এর metrics/tabular, dashboard, dashboard/plots উদাহরণ                                        | HTTP 404; website HTML, live OpenAPI-তেও অনুপস্থিত                                                      |
| Resources content page                                                                                       | HTTP 500; Origin-সহ error response-এ CORS header নেই, তাই browser-এ generic fetch/CORS failure হতে পারে |
| Manager invalid surface alias (`vegtype_999`)                                                                | HTTP 422 with validation message                                                                        |

## কোড ও UI

- `src/lib/nasa-power.ts` — URL builders, validation, API directory, metadata/error/series helpers, ArcGIS/AWS catalog।
- `src/lib/components/power/power-panel.svelte` — Data, Applications, Catalog & system, Maps & bulk panels।
- `src/lib/components/buttons/power-button.ts`, `src/lib/stores/power.ts`, `src/lib/power-map.ts` — map control/store/Regional overlay।
- `src/lib/tests/nasa-power.test.ts` — request, bounds, date, error, annual/climatology helper tests।
- `src/routes/+page.svelte`-এ map control ও panel যুক্ত; Historical panel-এর সঙ্গে একবারে একটি panel খোলা থাকে।

## Reference sources

- POWER service inventory: https://power.larc.nasa.gov/docs/services/
- REST API overview (including HTTP 429 and response-time guidance): https://power.larc.nasa.gov/docs/services/api/
- API request tutorial (synchronous-request, native-resolution and multiprocessing guidance): https://power.larc.nasa.gov/docs/tutorials/service-data-request/api/
- Temporal docs: https://power.larc.nasa.gov/docs/services/api/temporal/hourly/ · https://power.larc.nasa.gov/docs/services/api/temporal/daily/ · https://power.larc.nasa.gov/docs/services/api/temporal/monthly/ · https://power.larc.nasa.gov/docs/services/api/temporal/climatology/
- Application docs: https://power.larc.nasa.gov/docs/services/api/application/indicators/ · https://power.larc.nasa.gov/docs/services/api/application/windrose/ · https://power.larc.nasa.gov/docs/services/api/application/zones/
- System docs: https://power.larc.nasa.gov/docs/services/api/system/manager/ · https://power.larc.nasa.gov/docs/services/api/system/resources/
- Live OpenAPI: `https://power.larc.nasa.gov/api/temporal/{hourly,daily,monthly,climatology}/openapi.json`, `https://power.larc.nasa.gov/api/application/{indicators,windrose,zones}/openapi.json`, `https://power.larc.nasa.gov/api/system/{manager,resources}/openapi.json`
- NASA POWER ArcGIS docs: https://power.larc.nasa.gov/docs/services/arcgis/
- NASA POWER AWS docs/registry: https://power.larc.nasa.gov/docs/services/aws/ · https://registry.opendata.aws/nasa-power/
- Parameter metadata reference: https://github.com/ropensci/nasapower/blob/main/R/query_parameters.R

## Verification

- `npm run check` — ০ error, ০ warning
- `npm run lint` — Prettier ও ESLint pass
- `npm test -- --run` — ১৫টি test file, ৩৪৯টি test pass (POWER test: ১৫)
- `npm run build` — static production build সফল; dev preview route HTTP 200 দিয়ে SSR page ফেরত দিয়েছে।
- Build-এর সময় configured 1.5 MB chunk threshold অতিক্রমের warning দেখা যায়; build ব্যর্থ হয়নি।
