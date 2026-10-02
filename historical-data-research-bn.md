# ঐতিহাসিক আবহাওয়া ডেটা: no-key ও CORS-সহ গভীর গবেষণা

**পর্যালোচনার তারিখ:** ১ অক্টোবর ২০২৬ (Asia/Dhaka)  
**উদ্দেশ্য:** বড় historical range বজায় রেখে, API key/registration ছাড়া এবং standalone HTML থেকে browser `fetch()`-এ ব্যবহারযোগ্য ডেটা-উৎস আলাদা করা। এটি data-service ও HTTP response-header পরীক্ষা; নতুন উৎসগুলো Maps app-এ এখনো যুক্ত করা হয়নি।

## সিদ্ধান্ত এক নজরে

1. **বিশ্বব্যাপী, gap-free grid ও দীর্ঘ climate record:** বর্তমান app-এর Open-Meteo Historical Weather API (ERA5/ERA5-Land) সবচেয়ে সরাসরি উপযোগী। Key লাগে না; এই app-এর live run-এ archive response-এ wildcard CORS দেখা হয়েছে। এটি reanalysis, station observation নয়। Open-Meteo-র key-free free-use শর্ত non-commercial ব্যবহারের জন্য; commercial deployment-এ terms/plan আলাদা যাচাই করতে হবে।
2. **No-key station observations:** NOAA/NCEI-র Search + Access Data v1 API-গুলো CORS-সক্ষম; এর নতুন **GHCNh hourly**, **LCD v2** এবং **SSOD v2 daily** dataset-ও live-এ কাজ করেছে। Dhaka-র ক্ষেত্রে Tejgaon ও বিমানবন্দর স্টেশনের ২০২৪ coverage অনেক আলাদা—স্টেশন বাছার সময় distance-এর সঙ্গে বাস্তব valid-value count দেখতে হবে। SSOD-এর দিন UTC 00–23, বাংলাদেশের local climatological day নয়।
3. **দীর্ঘ climate-trend-এর মাসিক station temperature:** NOAA **GHCN-M v4 QCF**-এ সাধারণত PHA-adjusted series আছে; station-level exception/flag যাচাই করতে হবে। No-key static file ও CORS-enabled byte-range GET পাওয়া গেছে। পুরো global file প্রায় ১৭২.৯ MB; তবে বর্তমান ফাইলের fixed-width ordering ব্যবহার করে Tejgaon-এর জন্য প্রায় ১০ KB range-data দিয়ে একটি proof-of-concept extraction হয়েছে। এটি এখনো app বা Chromium-এ integration test নয়।
4. **দৈনিক station summary-র পুরোনো পথ:** GSOD ২০২৫-০৮-২৯-এ end-of-life; নতুন ডেটার জন্য SSOD v2 তার উত্তরসূরি। GSOD-কে নতুন integration-এর default করবেন না। GSOM আলাদা মাসিক summary—GHCN-M QCF নয়, আর Dhaka-তে TAVG খুব sparse।
5. **Meteostat bulk** no-key/CORS ও CC BY 4.0-সহ কাজ করেছে, কিন্তু daily file-এ station observation, provider merge ও DWD MOSMIX model/forecast fill মিশে আছে। Source field না দেখে একে pure historical observation বলা যাবে না; current-year file-এ ভবিষ্যৎ তারিখও এসেছে।
6. **উচ্চ-রেজোলিউশনের precipitation:** CHIRPS v3 (০.০৫°) আকর্ষণীয়, কিন্তু UCSB-এর raw directory ও একটি বাস্তব GeoTIFF response-এ CORS header নেই। ফলে key না লাগলেও বর্তমান CORS-only, proxy-বিহীন standalone app-এ cross-origin `fetch()` দিয়ে pixel data পড়া যাবে না।
7. **সহজ বিকল্প দৈনিক weather/solar:** NASA POWER no-key এবং sampled response-এ CORS-সক্ষম; কিন্তু meteorology grid প্রায় ০.৫° × ০.৬২৫° (প্রায় ৫০–৭০ km), ERA5-এর চেয়েও মোটা। Recent tail-এ MERRA-2/GEOS-IT source transition হয়। NASA GIBS satellite imagery ও OpenFreeMap basemap no-key/CORS-সক্ষম হতে পারে, কিন্তু numeric station/grid time-series-এর বিকল্প নয়।

**গুরুত্বপূর্ণ UI/বিশ্লেষণ সিদ্ধান্ত:** NOAA station data কখনো ERA5 reanalysis বা GFS/ICON/GRAPES forecast archive-এর সঙ্গে একই ধারাবাহিক series হিসেবে জোড়া দেওয়া উচিত নয়। ভবিষ্যতে যুক্ত করলে একই Historical panel ও unified timeline-এ আলাদা, স্পষ্ট `Station observations` source হিসেবে দেখানো যায়; আলাদা satellite button বা timeline প্রয়োজন নেই।

## উৎসগুলোর তুলনা

| উৎস | ডেটার প্রকৃতি ও coverage | Key / direct CORS | উপযোগিতা ও প্রধান caveat |
| --- | --- | --- | --- |
| Open-Meteo Historical Weather | Global gridded reanalysis; ERA5 ১৯৪০ থেকে, ERA5-Land ১৯৫০ থেকে; hourly/daily | API key লাগে না (free access-এর terms প্রযোজ্য); বর্তমান app-এর live browser log-এ archive API-র `ACAO: *` | দীর্ঘ, spatially complete historical series ও map-এ click-location query-র জন্য সেরা fit। Climate trend-এ একই reanalysis model ধরে রাখতে হবে। |
| Open-Meteo Historical Forecast | GFS, ICON, CMA GRAPES-সহ operational forecast archives; সাম্প্রতিক বছরগুলো | API key লাগে না; app-এ সরাসরি route/test করা হয়েছে | Forecast backtest/সাম্প্রতিক archive; climate reanalysis নয়। Partial first-year start date ও source coverage আলাদা করে রাখতে হবে। |
| NOAA/NCEI Search + Access Data Service (`daily-summaries`) | Global land station observations; GHCN-Daily-তে ১০০,০০০-এর বেশি station, ১৮০ দেশ/অঞ্চল, কিছু record ১৭৫ বছরেরও বেশি | Tested Search/Data GET-এ token/API key ছাড়া HTTP ২০০, `ACAO: *` | Local observation-day daily Tmax/Tmin/precipitation-এর জন্য উপযোগী; station density, variable availability, missing day, source ও freshness ভিন্ন। Homogenized climate grid নয়; climate-trend-এর জন্য GHCN-M QCF আলাদা। |
| NOAA GHCNh hourly | Global hourly/synoptic station observations; Dhaka Tejgaon archive ১৯৫৪ থেকে, airport ১৯৯৬ থেকে; station/variable coverage অসম | Search + Access Data GET-এ no-key HTTP ২০০, `ACAO: *`; static PSV byte range-ও HTTP ২০৬ | Hourly observation-এর সেরা tested no-key route। রিপোর্টের সময় অনিয়মিত/এক ঘণ্টায় একাধিক হতে পারে; explicit time, source/quality/report metadata ও UTC রাখতে হবে। ২০২৪ temperature Search coverage Tejgaon ৩১.৬%, airport ১০০%; full-year Tejgaon request একবার empty body দিয়েছে—retry/chunk/cache আবশ্যক। |
| NOAA LCD v2 | NCEI station/year CSV; hourly/daily/monthly summary, প্রধানত U.S. + সীমিত international coverage। Dhaka ২০২৪ Tejgaon/Airport Search-এ hourly elements-ই তালিকাভুক্ত | Search/Data no-key HTTP ২০০, `ACAO: *`; Airport annual CSV Range HTTP ২০৬, `ACAO: *`; CSV SI/metric | Dhaka-তে GHCNh-এর convenient variant, কিন্তু largely redundant: tested station-year-এ daily Tmax/Tmin/precip field নেই; Tejgaon hourly precipitation coverage ০.৫১%, airport-এ precipitation datatype নেই। Dhaka daily-observation fallback নয়; use terms/citation আলাদাভাবে পড়ুন। |
| NOAA SSOD v2 | GHCNh থেকে তৈরি 00–23 UTC daily summary; Dhaka Tejgaon annual file ১৯৫৪–৬৩, ১৯৭৩–২০২৬—১৯৬৪–৭২ অনুপস্থিত | Search + Access Data GET no-key HTTP ২০০, `ACAO: *`; yearly CSV Range HTTP ২০৬, `ACAO: *`; NCEI metadata-তে open data/no use restriction | GSOD-এর বর্তমান successor; tested ২০২৪-এ Tejgaon temperature ৩৪৫/৩৬৬, airport ৩৬৫/৩৬৬ valid। `-9999.9` sentinel ফিল্টার করুন; Search coverage valid-value count নয়। UTC-day; local-day official rainfall/Tmax/Tmin-এর বিকল্প নয়। |
| NOAA GHCN-M v4 QCF | মাসিক station mean temperature, সাধারণত PHA-adjusted; global earliest record ১৮শ শতক, তবে station-by-station period ভিন্ন; Tejgaon sample ১৯৮৩-১২–২০২৬-০৮-এ ২৯৮ valid month | Key-free static `.dat/.inv`; file ও byte-range GET-এ `ACAO: *`, Range HTTP ২০৬ | দীর্ঘ climate-trend-এর জন্য শক্তিশালী station candidate। Global QCF data file ১৭২.৯ MB; per-station API নেই। বর্তমান fixed-width record ordering দিয়ে selective range-fetch proof আছে, কিন্তু official API contract নয়—version validation, Worker/cache ও browser test দরকার। |
| NOAA GSOD (legacy) | পুরনো daily summary; ২০২৫-০৮-২৮ পর্যন্ত; Dhaka Tejgaon TEMP-তে GHCN-Daily-এর একই ১১,১৫২ date/value | Search/Data no-key ও `ACAO: *` পরীক্ষা হয়েছে | NCEI ২০২৫-০৮-২৯-এ end-of-life ঘোষণা করেছে, successor SSOD v2। নতুন integration-এ নয়; legacy/non-US terms এবং GSOD duplicate data বিবেচনা করুন। |
| NOAA GSOM | GHCN-Daily-ভিত্তিক monthly summary; Tejgaon ১৯৮৫–২০২৫ sample-এ PRCP ১২৩, TMAX ৮২, TAVG মাত্র ৪ valid month | Search/Data no-key, `ACAO: *`; static CSV-তে Range HTTP ২০৬ | Monthly convenience layer, homogenized GHCN-M নয়। Dhaka TAVG coverage খুব sparse; climate trend-এর বিকল্প নয়। |
| Meteostat daily bulk | Station/year gzip CSV; ২০২৪ Dhaka `41923` file ৬,৭০৬ byte; station sources mix; current-year file-এ DWD MOSMIX forecast-ও পাওয়া | no-key station JSON/CSV.gz/32.5 MB station DB-তে `ACAO: *`; CC BY 4.0 attribution | সহজ secondary/fallback, pure historical observation নয়। `*_source` filter করুন, forecast/future values আলাদা রাখুন; global `stations.db` nearest-station lookup-এর জন্য ভারী। |
| NOAA GHCN-Daily public AWS S3 | একই station dataset; current bucket-এ প্রতি station CSV ও year-based files | Anonymous S3 GET/Range-এ `ACAO: *`; AWS account লাগে না | Data Service API না চাইলে raw alternative। Station-coordinate registry `ghcnd-stations.txt` প্রায় ১১.৪ MB; inventory প্রায় ৩৬.৪ MB—client-এ nearest station খুঁজতে সরাসরি এই metadata নামানো ব্যয়বহুল হতে পারে। Bucket-এর prefix পরিবর্তন চলছে। |
| NASA POWER Daily | দৈনিক meteorology (MERRA-2/GEOS-IT) ও solar; meteorology ১৯৮১ থেকে near-real-time; solar-এর source/coverage পৃথক | no-key request HTTP ২০০, `ACAO: *` live header test | ২০টি পর্যন্ত point parameter/request; UTC বা LST স্পষ্টভাবে বেছে নিতে হয়। Meteorology প্রায় ০.৫° × ০.৬২৫°; solar প্রায় ১° × ১°। গ্রিড coarse, near-real-time tail source বদলায়। |
| CHIRPS v3 | Gauge + satellite blended precipitation; land, ৬০°S–৬০°N, ০.০৫°, ১৯৮১–near-present | Public repository; sampled raw TIFF-এ `ACAO` অনুপস্থিত | Bangladesh rainfall map-এ resolution ভালো। Daily `rnl`/`sat` হলো pentad total-কে ERA5/IMERG daily ratios দিয়ে ভাগ করা—স্বতন্ত্র native daily measurement নয়। Browser-readable point API/CORS পাওয়া যায়নি। |
| CHIRTS-ERA5 | দৈনিক Tmax/Tmin, heat index/WBGT-জাতীয় পণ্য; quasi-global ৬০°S–৭০°N, ০.০৫°, ১৯৮০ থেকে near-present | Public static files; sampled NetCDF-এ `ACAO` অনুপস্থিত | High-resolution temperature alternative, তবে full-year per-variable NetCDF sample `7,183,557,787` bytes = `7.18 GB` (দশমিক) = `6.69 GiB`; point-query API নয়, browser integration-এ CORS/size বাধা। এটি CHIRTS climatology ও ERA5 daily variation মিশিয়ে তৈরি derivative। |
| NASA GIBS | Satellite imagery tiles/metadata | এই app-এর tested metadata ও tiles HTTP ২০০, `ACAO: *`; key লাগেনি | Timeline-এ ছবি দেখানোর জন্য; numeric temperature/rainfall series নয়। Swath/no-data gap imagery coverage-এর অংশ হতে পারে। |
| Copernicus CDS direct ERA5 | Original ERA5 reanalysis; ১৯৪০–বর্তমান | Dataset download-এর জন্য login, terms acceptance ও CDS API identity/public key দরকার | Open dataset, কিন্তু browser one-file no-key শর্ত পূরণ করে না। Direct retrieval-এ বড় data extract/manage করতে হয়; Open-Meteo API সহজ no-key route। |
| NOAA CDO API v2 | NOAA climate/station query | Token আবশ্যক; token ছাড়া test HTTP ৪০০, message: `Token parameter is required`; response-এ তবুও `ACAO: *` | CORS থাকা authentication-এর বিকল্প নয়। Official CDO docs token-এর rate limit বলে; no-key constraint-এ এই v2 endpoint বাদ। |

## নতুন live ফল: NOAA/NCEI-র key-free station route

NCEI-তে দুটি API পরিবার আলাদা করে পরীক্ষা করেছি:

- **Search Service:** `https://www.ncei.noaa.gov/access/services/search/v1/data`
- **Access Data Service:** `https://www.ncei.noaa.gov/access/services/data/v1`
- **ভুল করে এক করে ফেলবেন না:** `https://www.ncei.noaa.gov/cdo-web/api/v2/...` হলো আলাদা CDO v2 API এবং সেখানে token প্রয়োজন।

Official Search/Data Service documentation-এ GET request, dataset, station, date, bounding box, data type ও JSON/CSV format নির্ধারণের বর্ণনা আছে; token field লাগে না। Live request-এ কোনো token/API key/cookie পাঠানো হয়নি। GET-এর সঙ্গে `Origin: https://maps-test.example` দিয়ে successful response-এ wildcard CORS পাওয়া গেছে। এটি actual API/header verification; নতুন app UI-তে browser end-to-end integration এখনো করা হয়নি।

### Dhaka-র কাছের station আবিষ্কার

পরীক্ষিত Search request (bbox-র ক্রম: North, West, South, East):

```text
https://www.ncei.noaa.gov/access/services/search/v1/data?dataset=daily-summaries&startDate=2024-01-01&endDate=2024-01-07&bbox=24.1,90.2,23.5,90.6
```

ফল: HTTP ২০০, `Access-Control-Allow-Origin: *`; bbox-তে একটি station পাওয়া গেছে—`BGM00041923`, নাম `TEJGAON, BG`, অবস্থান `23.779°N, 90.383°E`। Search response station-এর available element, start/end ও estimated coverage-ও দেয়। এতে full `ghcnd-stations.txt` নামিয়ে nearest station খোঁজার প্রয়োজন নাও হতে পারে।

### Station data query

পরীক্ষিত Access Data request:

```text
https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=BGM00041923&startDate=2024-01-01&endDate=2024-01-07&dataTypes=TMAX,TMIN,TAVG,PRCP&includeAttributes=true&format=json
```

ফল: HTTP ২০০, `application/json`, `ACAO: *`; কোনো token/API key লাগেনি। `includeAttributes=true` measurement, quality ও source flag দেয়। CSV-ও সমর্থিত। GHCN daily raw scale-এ temperature সাধারণত ০.১°C এবং precipitation ০.১ mm এককে; plot করার আগে convert ও missing/flag semantics যাচাই করতে হবে। `TAVG` না থাকলে নিজে থেকে data আছে বলে ধরে নেওয়া বা absent date-কে zero বসানো যাবে না।

### বড় ইতিহাসের বাস্তব completeness

`BGM00041923`-এর `TAVG`, `1945-01-01` থেকে `2025-08-24` চেয়ে:

- HTTP ২০০, `ACAO: *`; JSON প্রায় ১,২০৪,৪১৯ byte (প্রায় ১.১৫ MiB), CSV প্রায় ৬२४,৫৬১ byte (প্রায় ০.৬০ MiB)।
- ১১,১৫২টি reported `TAVG` day; প্রথম `1945-02-28`, শেষ `2025-08-24`। এটি প্রতিদিনের পূর্ণ ৮০ বছরের series নয়—অনুপস্থিত দিনগুলো অনুপস্থিতই থাকে।
- Search API-এর station coverage estimate: `TAVG` ৩৭.৯৪% (`1945-02-28`–`2025-08-24`), `TMAX` ৫৩.৬৩% (`1978-10-28`–`2025-08-24`), `TMIN` ২৫.৯২% (`1978-09-11`–`2025-08-23`), `PRCP` ৫৬.৯৯% (`1982-02-09`–`2025-08-24`)।
- অর্থাৎ Dhaka-র কাছে long record থাকলেও তাতে অনেক missing day এবং প্রায় ১৩ মাসের freshness gap আছে (যাচাইয়ের তারিখ ২০২৬-১০-০১)। অন্য station-এ update date আলাদা হতে পারে; search response-এর per-station `endDate` দেখিয়ে freshness জানানো উচিত।
- Search response-এ CSV source file-এর আনুমানিক size `1,233,978` byte ছিল। NCEI Access Data query-তে শুধু TAVG ও নির্বাচিত সময়সীমা চাওয়ায় JSON ১.২০ MB/CSV ০.৬২ MB হয়েছে—একটি marker-এর জন্য পুরো global annual archive download করার চেয়ে অনেক ছোট।

**মান ও ব্যাখ্যা:** NCEI GHCN-Daily একটি multi-source station archive এবং দৈনিক quality checks চালায়; তবুও station-period অসম, কিছু station precipitation-only, এবং দৈনিক station record বিভিন্ন observation cut-off/source থেকে আসতে পারে। NCEI জানায় GHCN-Daily ঐতিহাসিক station/instrument practice-এর bias-এর জন্য homogenized নয়। তাই এটি observation validation বা local weather history-তে মূল্যবান, কিন্তু সরাসরি ERA5 climate trend-এর সঙ্গে splice করার উপাদান নয়। Quality/source flags রেখে দিতে হবে।

### Raw AWS পথ—API ছাড়া বিকল্প

`https://noaa-ghcn-pds.s3.amazonaws.com/` থেকে anonymous GET এবং `Origin`-সহ byte-range পরীক্ষা করা হয়েছে। `ghcnd-stations.txt` ও `ghcnd-inventory.txt` `ACAO: *` দেয়; station data-র বর্তমান path pattern `csv/by_station/{stationId}.csv`। Tejgaon `BGM00041923.csv` HTTP ২০০, প্রায় ১,১৮৩,১৩৫ byte, `ACAO: *`।

**Performance সতর্কতা:** `csv/by_year/2025.csv` sample-এর reported size প্রায় ১.২৬ GB; এটি browser-এ কখনো পুরো নামাবেন না। Point query-তে station-specific API/file ব্যবহার করুন। NCEI Search Service bbox দিয়ে station/coverage আবিষ্কার করা গেলে ১১.৪ MB station registry ও ৩৬.৪ MB inventory file client-এ টানার খরচ এড়ানো যায়। NOAA/AWS জানায় GHCN bucket-এর key prefix-গুলো পরিবর্তন/পുനর্বিন্যাসের মধ্যে; deployment-এর আগে current registry/docs ও live object paths পুনরায় যাচাই করুন।

## নতুন live verification: NOAA GHCN-M, GHCNh/SSODv2, GSOD/GSOM ও Meteostat

নিচের পরীক্ষাগুলো key/token ছাড়া GET request-এ করা হয়েছে। Python `requests` দিয়ে `Origin: https://maps-test.example` পাঠিয়ে response header/body দেখা হয়েছে—এটি CORS header verification, কিন্তু standalone HTML-এর Chromium end-to-end পরীক্ষা নয়। তাই কোনো নতুন উৎসকে app-এ যুক্ত করা হয়েছে বলে ধরা যাবে না।

### NOAA GHCN-M v4 QCF: দীর্ঘ climate trend-এর মাসিক station data

GHCN-M হলো monthly station climate archive; **QCF** হলো quality-controlled, pairwise-homogenization-adjusted series। NOAA-র current access directory-তে global `tavg` data `.dat` ও station inventory `.inv` নামে পাওয়া যায়; token লাগে না, index, inventory, data file—সব পরীক্ষিত response-এ `Access-Control-Allow-Origin: *` ছিল। Data file-এর `Range: bytes=0-127`-এ HTTP 206 এসেছে। বর্তমান QCF `.dat` প্রায় **172.9 MB**, `.inv` প্রায় **1.93 MB** এবং inventory-তে **27,962** station entry দেখা গেছে।

Dhaka-র Tejgaon station `BGM00041923`-এর ক্ষেত্রে current QCF file পরীক্ষা:

- Inventory coordinate প্রায় `23.779°N, 90.383°E`; বর্তমান data record file-এ ৪১টি annual record line, ১৯৮৩-১২ থেকে ২০২৬-০৮ পর্যন্ত **২৯৮টি non-missing monthly mean-temperature** value।
- QCF data-র temperature integer hundredths °C-এ; display-র আগে `100` দিয়ে ভাগ করতে হবে। `-9999` missing value এবং QC/source flag-গুলো বাদ না দিয়ে সংরক্ষণ করুন। QCU হলো unadjusted series; QFE estimated/infilled value-সহ হতে পারে—climate trend-এর জন্য এগুলোকে QCF-এর সঙ্গে মিশিয়ে ফেলবেন না। NOAA documentation-এ QCF-এর high-latitude কিছু station-এর unadjusted data থাকার caveat আছে; তাই শুধু suffix দেখে প্রতিটি station-কে homogenized ধরে না নিয়ে dataset documentation/flags-ও দেখুন।
- একটি **experimental selective-fetch proof-of-concept**-এ current file-এর ১১৬-byte fixed-width records এবং station-ID ordering ধরে ২১টি byte-range lookup-এ target offset খুঁজেছি (প্রায় ১.৯ সেকেন্ড), তারপর প্রায় ৭.৪ KB record block পড়েছি। Target station-এর data payload প্রায় ১০ KB-এর কাছাকাছি—পুরো ১৭২.৯ MB নামাতে হয়নি; ১.৯৩ MB inventory একবার cache করলে সেটি বারবার আনতে হবে না।
- এই offset/binary-search কৌশল NOAA-র per-station API নয় এবং file format/order ভবিষ্যতে বদলাতে পারে। প্রতিটি নতুন version-এ record width, sortedness, line ending ও version/date verify করতে হবে; fallback না রেখে production-এ সরাসরি নির্ভর করবেন না। Chromium `fetch()`/Range, preflight, preview-host origin এবং Worker execution এখনো পরীক্ষা হয়নি।

**রায়:** long-term monthly station-temperature trend-এর জন্য খুব promising no-key source। প্রথমে background Worker-এ version-checkable range reader, ছোট inventory cache, IndexedDB result cache এবং source/flag display prototype করুন। Static access directory: [NCEI GHCN-M v4 temperature access](https://www.ncei.noaa.gov/data/global-historical-climatology-network-monthly/v4/temperature/access/). GHCN-M-এর redistribution/license wording এই পর্বে আলাদাভাবে নিশ্চিত করা হয়নি—attribution দিন এবং deploy-এর আগে current product/readme terms যাচাই করুন।

### NOAA GHCNh: raw hourly/synoptic station observations

NCEI Search ও Access Data Service-এ `dataset=global-historical-climatology-network-hourly` ব্যবহার করে station discovery এবং নির্বাচিত time/variable query no-key-তে কাজ করেছে; দুটিতেই HTTP 200 ও `ACAO: *` পাওয়া গেছে। GHCNh হলো heterogeneous station reports-এর archive; nominally hourly হলেও report interval, report type, duplicate time ও element availability স্টেশনভেদে বদলায়। Official dataset metadata-তে CC0 license দেওয়া আছে; মূল NOAA/NCEI citation এবং source/QC metadata রাখুন।

পরীক্ষিত station pair: Tejgaon `BGI0000VGTJ` (23.779°N, 90.383°E) ও Hazrat Shahjalal International Airport `BGI0000VGHS` (প্রায় 23.843°N, 90.398°E)। Dhaka Search result ২০২৪-এর Tejgaon temperature coverage প্রায় **31.625%**, airport **100%**; airport-এর ২০২৪ station-year file প্রায় **13.77 MB**, Tejgaon file প্রায় **2.45 MB**। ২০২৬ Search record দুটির শেষ observation `2026-09-28`; Airport-এ শেষ timestamp `2026-09-28T14:59:59Z` দেখা গেছে। Search coverage-কে valid-value count ধরে নেবেন না।

এক দিনের Tejgaon query-তে ৮টি observation (প্রতি ৩ ঘণ্টায় একটি), মোট প্রায় ৬৭৫ byte, পাওয়া গেছে। ২০২৪ airport full-year-এর `DATE`, `temperature` ও quality data নির্বাচিত query প্রায় **17,353 rows / 1.46 MB** ফিরিয়েছে—দৈনিক বা ঘণ্টাপ্রতি ঠিক একটি row নয়; report timestamps ধরে deduplicate/aggregate করার আগে report type বুঝতে হবে। বিপরীতে Tejgaon-এর পূর্ণ ২০২৪ query একবার HTTP 200 হলেও body শূন্য-byte ছিল; Q1 query-তে 717 rows ও one-day query-তে 8 rows এসেছে। দ্রুত ধারাবাহিক কিছু call-এর পর HTTP 503-ও দেখা গেছে। তাই range chunk, exponential retry, request concurrency cap এবং cache জরুরি; HTTP 200 মানেই non-empty/complete body নয়।

Data query-তে `DATE`-কে `dataTypes`-এ স্পষ্টভাবে চাইতে হয়েছে। `includeAttributes=true` দিলেই প্রয়োজনীয় GHCNh source/quality/report fields স্বয়ংক্রিয়ভাবে সবসময় আসে না; দরকার হলে `temperature_Quality_Code`, `temperature_Source_Code`, `temperature_Report_Type`, `temperature_Source_Station_ID`-এর মতো fields explicit যোগ করুন। API output UTC timestamp; local plotting-এর আগে timezone/day-boundary স্পষ্ট করুন।

নমুনা request pattern:

```text
https://www.ncei.noaa.gov/access/services/data/v1?dataset=global-historical-climatology-network-hourly&stations=BGI0000VGTJ&startDate=2024-01-01T00:00:00Z&endDate=2024-01-01T23:59:59Z&dataTypes=DATE,temperature,temperature_Quality_Code,temperature_Source_Code,temperature_Report_Type&format=json
```

**রায়:** hourly observational history-এর জন্য সরাসরি উপযোগী no-key route, কিন্তু station selection ও parsing সচেতনভাবে করতে হবে। আগে Search দিয়ে নির্বাচিত সময়/element-এ station rank করুন, এরপর ছোট window-এ data আনুন; complete year bulk file browser-এ নামানো এড়ান।

### NOAA LCD v2: key-free ও metric CSV, কিন্তু Dhaka-তে দৈনিক summary নেই

LCDv2 (`dataset=local-climatological-data-v2`) হলো GHCNh/GHCNd-ভিত্তিক station/year CSV ও customized Data Service; NCEI product page অনুযায়ী মূল network প্রায় ১,০০০ U.S. station এবং কিছু সীমিত international station—বিশ্বজুড়ে সমান coverage নয়। Search API ও Data API no-key-তে HTTP 200, `ACAO: *`; bulk CSV SI/metric units-এ। ২০২৪ Dhaka bbox Search-এ Tejgaon `BGI0000VGTJ` ও Airport `BGI0000VGHS`—দুই station-ই পাওয়া গেছে।

Dhaka-র ২০২৪ per-station ফল:

- Tejgaon Search-এ ১৭টি data type, সবকটি hourly/metadata; `HourlyDryBulbTemperature` coverage **31.568%**, `HourlyPrecipitation` মাত্র **0.507%**। Airport-এ ১৩টি data type; `HourlyDryBulbTemperature` coverage **100%**, কিন্তু precipitation type-ই নেই। Search result-এ কোনো `Daily...` variable ছিল না।
- Yearly station CSV-র `Range: bytes=0-1023` request-এ Tejgaon file **1,510,770 byte** এবং Airport file **10,160,909 byte**; উভয়েই HTTP 206 ও `ACAO: *`। তাই airport-এর সম্পূর্ণ ১০ MB file নামানোর দরকার নেই—Data API selected variables/time আরও ছোট করে দেয়।
- Data API-তে `units=metric`, `2024-01-01`–`2024-01-07` ও `DATE,HourlyDryBulbTemperature,HourlyDewPointTemperature,...` চাইলে Tejgaon **55 rows / 8,913 byte**, Airport **336 rows / 54,435 byte** ফিরিয়েছে। Tejgaon report type `FM-12`-এ সাধারণত প্রতি ৩ ঘণ্টায়, airport `FM-15`-এ প্রতি ৩০ মিনিটে record দেখা গেছে; তাই raw hourly timestamps একরকম নয়।
- Dhaka-তে `DailyAverageDryBulbTemperature`, `DailyMaximumDryBulbTemperature`, `DailyMinimumDryBulbTemperature`, `DailyPrecipitation` explicit চাইলে HTTP 200 এলেও returned JSON-এ ওই daily value field আসেনি—শুধু `DATE`, `STATION`, `SOURCE`, `REPORT_TYPE` ছিল। অর্থাৎ এই station/year window-তে daily summaries নেই; API 200-কে variable-availability ভেবে নেবেন না।

**রায়:** metric CSV-সহ no-key hourly station route হিসেবে technically কাজ করে, কিন্তু Dhaka-র জন্য GHCNh-এর সঙ্গে প্রায় একই source/observation, annual station file বড়, hourly precipitation অনুপস্থিত বা খুব sparse, এবং local daily summary field নেই। Daily chart-এর জন্য SSOD v2 (UTC day) বা GHCN-Daily (local observation-day semantics) বেশি অর্থবহ; LCDv2-কে আলাদা করে integrate করার প্রয়োজন কম। Dataset metadata DOI citation দেয়; এই পরীক্ষায় আলাদা CC0/CC BY license label নিশ্চিত করা হয়নি—reuse-এ NCEI citation/terms অনুসরণ করুন।

### NOAA SSOD v2: GSOD-এর current successor, তবে station gap ও sentinel আছে

NCEI-র SSOD v2 পৃষ্ঠায় এটিকে GSOD-এর successor বলা হয়েছে; এটি GHCNh hourly/synoptic reports থেকে daily summary তৈরি করে এবং daily update পায়। Dataset Search/Search API, Access Data API ও station-year CSV—সবগুলোতেই পরীক্ষিত no-key GET-এ `ACAO: *`; annual CSV-তে `Range` দিলে HTTP 206 এসেছে। Dataset metadata-তে “Open Data, no use restrictions” বলা আছে; citation-এ NOAA/NESDIS/NCEI উল্লেখ করুন। Official NCEI daily-summary guidance অনুযায়ী SSOD-এর দিন **00–23 UTC**; Dhaka-তে এটি আনুমানিক 06:00 থেকে পরদিন 05:59 local। GHCN-Daily local observation-day practice-এর সঙ্গে একই day definition নয়।

পরীক্ষিত ২০২৪ Dhaka Search-এ Tejgaon ও Airport annual CSV যথাক্রমে **55,709** ও **65,053 byte**; API Search coverage যথাক্রমে **98.63%** ও **100%** দেখাল। কিন্তু full-year Access Data response-এ:

- Tejgaon: ৩৬০ returned date row; mean/max/min-এ **৩৪৫ valid** এবং ১৫টি missing/sentinel।
- Airport: ৩৬৬ returned row; mean/max/min-এ **৩৬৫ valid** এবং ১টি missing/sentinel।
- `-9999.9` missing sentinel বাদ দিন। Precip datatype-এর নাম `total_precipitation`; শুধু `precipitation` চাইলে field মেলে না। ২০২৪-এ Tejgaon-এর ৩৬০ row-এর ৩৫৯ valid হলেও Airport-এর **৩৬৬/৩৬৬ precipitation-ই `-9999.9`**, measurement code `I`। Search-এ Airport precipitation coverage 100% দেখানো হয়েছিল—অর্থাৎ Search coverage value-availability-এর নিশ্চয়তা নয়। Measurement code দরকার হলে `*_Measurement_Code` field explicit request করুন; raw code সংরক্ষণ করুন, decode না করে অর্থ অনুমান করবেন না।
- CSV-তে `DATE` explicit চাইলে এই পরীক্ষায় duplicate `DATE` header দেখা গেছে; browser parser-এ robust header handling রাখুন অথবা JSON schema যাচাই করে ব্যবহার করুন।

Tejgaon-এর দীর্ঘ history-তে Search **৬৪ annual file** পেয়েছে: **1954–1963**, তারপর **1973–2026**; **1964–1972**-এ ৯ বছরের gap। `2026-09-28` ছিল Search-এর শেষ available date; ওই date-এর Access row-তে temperature sentinel ছিল, তাই শেষ valid temperature `2026-09-27`। ১৯৫৪–২০২৫-এর একটিমাত্র broad Access Data query শুধু gap-এর আগের segment দিয়েছে—৩,৬৫১ row, ১,৯৯৬ valid mean-temperature value, শেষ `1963-12-31`। Search-এ থাকা পরে-র data পেতে আলাদা `1973-01-01`–`2025-12-31` query দরকার: **17,267 rows**, **10,632 valid** mean-temperature value, প্রায় **831,497 byte** CSV। দুই segment মিলে ১৯৫৪–২০২৫-এ **12,628 valid daily mean-temperature value**, কিন্তু মাঝখানের ৯ বছর অনুপস্থিত, আর অন্য তারিখে sentinel/missing আছে। অর্থাৎ broad date range একবারেই চাইলে full history পাওয়া যাবে—এমন ধরে নেওয়া যাবে না; Search-এ available year/gap দেখে range split করুন।

**রায়:** compact daily station summary ও বর্তমান GSOD replacement হিসেবে শক্তিশালী। কিন্তু raw valid values filter ও station/gap metadata আবশ্যক। NCEI-এর guidance অনুযায়ী local climatological-day Tmax/Tmin এবং daily precipitation-এ GHCN-Daily অধিক উপযোগী হতে পারে; SSOD-কে local daily observation বলে label করবেন না এবং GHCN-Daily/SSOD/GHCNh-কে একই uninterrupted series হিসেবে splice করবেন না।

### GSOD end-of-life ও GSOM-এর সীমা

NCEI operating-system notice জানায় **GSOD ২০২৫-০৮-২৯-এ end-of-life**, আর update পাবে না; replacement SSOD। তাই GSOD query HTTP 200 বা historical file পাওয়া গেলেও ২০২৫-০৮-২৯-এর পরের absence transient outage নয়। Tejgaon GSOD TEMP-এর **11,152** day/value pair GHCN-Daily TAVG-এর একই তারিখগুলোর সঙ্গে মিলে গেছে (rounding difference সর্বোচ্চ ০.০৫°C); ফলে এই station-এ daily mean temperature-এর জন্য GSOD আলাদা independent record দেয় না। GSOD legacy readme-তে non-U.S. data-র non-commercial use restriction-ও আছে—reuse-এর আগে current terms পড়ুন।

**GSOM** (`global-summary-of-the-month`) আলাদা no-key Search/Access dataset; tested response `ACAO: *`, direct annual CSV byte range HTTP 206। Dhaka Tejgaon `BGM00041923`-এর 1985–2025 query-তে precipitation **123** valid month, TMAX **82**, TMIN **11**, TAVG মাত্র **4** (2018-03 থেকে 2020-03) পাওয়া গেছে। এটি daily record-এর monthly roll-up, GHCN-M-এর PHA-adjusted monthly climate series নয়; বিশেষ করে Dhaka monthly mean-temperature trend-এর বিকল্প হিসেবে ব্যবহারযোগ্য নয়।

### Meteostat: সহজ bulk, কিন্তু observation/model provenance আলাদা রাখতে হবে

Meteostat station-year daily gzip CSV, station JSON ও station database-এ no-key GET পরীক্ষা করে `ACAO: *` পাওয়া গেছে। Dhaka station ID `41923`-এর ২০২৪ gzip CSV মাত্র **6,706 byte** এবং ৩৬৬ date row; `stations/41923.json` প্রায় ৪০০ byte। কিন্তু global `stations.db` **32,485,376 byte**—client-side nearest-station search-এর জন্য ভারী। Long-range station files বছরভিত্তিক আলাদা fetch/decompress করতে হবে; সব বছর আছে ধরে নেওয়া যাবে না।

Meteostat docs অনুযায়ী daily file-এ একাধিক provider এবং missing-value substitute/model data থাকতে পারে। Live station inventory-তে `ghcnd` temperature `1945-02-28`–`2025-08-24`, আর `dwd_mosmix` temperature ২০২৬ সালের অক্টোবর পর্যন্ত দেখা গেছে; current-year file-এ আজকের তারিখের পরের row-ও ছিল এবং সেগুলো DWD MOSMIX forecast source-এর। ফলে `temp_source`/`prcp_source` ইত্যাদি fields সংরক্ষণ না করে অথবা forecast rows বাদ না দিয়ে এগুলোকে observation history বলা যাবে না।

Meteostat-এর licensing page CC BY 4.0 attribution চায়; Terms of Use-এ public beta files/service যে notice ছাড়াই block/discontinue হতে পারে তা বলা আছে। **রায়:** convenient secondary/fallback, কিন্তু primary NOAA station record বা reanalysis-এর সঙ্গে source label/forecast status ছাড়া merge নয়; source metadata ও attribution UI/export-এ রাখুন।

## High-resolution gridded alternatives: resolution বনাম browser access

### CHIRPS v3 — rainfall-only

UCSB Climate Hazards Center-এর বর্তমান page বলছে CHIRPS v3 ৬০°S–৬০°N land domain-এ ০.০৫° grid এবং ১৯৮১ থেকে near-present; CHIRPS v2 উৎপাদন ২০২৬ সালের ডিসেম্বরের পর বন্ধ হবে। v3-তে final ও preliminary stream আলাদা। Daily product-এর `rnl` ERA5 daily precipitation ratio দিয়ে, `sat` IMERG Late V07 daily precipitation ratio দিয়ে pentad-total-কে দিনে ভাগ করে; মোট pentad accumulation রক্ষা হয়। তাই daily value high-resolution হলেও daily disaggregation source-নির্ভর—এটিকে independent gauge reading বা native daily precipitation বলে বর্ণনা করবেন না। `sat` stream IMERG-era; দীর্ঘতম ১৯৮১ record-এর জন্য `rnl` route প্রযোজ্য।

সরাসরি CORS test:

- CHC repository directory ও `readme.txt` response-এ `Access-Control-Allow-Origin` ছিল না।
- `https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/final/rnl/2025/chirps-v3.0.rnl.2025.01.01.tif`-এ byte-range GET HTTP ২০৬ (`image/tiff`), object size `14,134,274` byte; `ACAO` অনুপস্থিত।
- ২০২৬-১০-০১-এ live repository listing-এ final daily `rnl`/`sat` stream `2026-08-31` পর্যন্ত এবং preliminary daily `sat` `2026-09-25` পর্যন্ত ছিল। এটি listing snapshot, স্থায়ী coverage guarantee নয়।
- NOAA CoastWatch-এর CHIRPS v2 ERDDAP mirror-এ সফল point JSON query (১৯৮৪ ও ২০২৪ তারিখ) HTTP ২০০ হলেও `ACAO` অনুপস্থিত ছিল; dataset info-তে time start `1984-01-01` এবং latest end `2025-02-28` দেখা গেছে। এটি v3-এর বিকল্প নয় এবং সরাসরি browser fetch-এর উপযোগী নয়।

**রায়:** তথ্য বিনামূল্যে/public ও key-free হলেও বর্তমান standalone HTML-এর no-proxy CORS শর্তে সরাসরি ব্যবহার উপযুক্ত নয়। Server-side crop/COG service, নিজের অনুমোদিত mirror বা user-side file download যোগ না করলে browser app pixel data পড়তে পারবে না।

### CHIRTS-ERA5 — high-resolution temperature

CHC-এর official summary অনুযায়ী CHIRTS-ERA5 হলো প্রায় ০.০৫° (৫ km), ৬০°S–৭০°N, ১৯৮০ থেকে near-present daily Tmax/Tmin এবং derived heat/comfort parameters। পদ্ধতিতে CHIRTS-এর satellite/station-based monthly climatology ও ERA5 daily variation একত্রে/downscale করা হয়; তাই এটিও raw station observation নয়।

`CHIRTS-ERA5.daily_Tmax.2024.nc`-এর anonymous byte-range GET HTTP ২০৬ পেয়েছে, total object size `7,183,557,787` byte = `7.18 GB` (দশমিক) = `6.69 GiB`, কিন্তু response-এ CORS header ছিল না। এটি point-query API নয়। Research-grade local preprocessing-এ উপযোগী হতে পারে; browser-এ marker click করলেই full annual NetCDF নামানোর পথ performance দিক থেকে অনুপযুক্ত।

## NASA POWER: no-key, CORS-সক্ষম, কিন্তু coarse ও source-aware হতে হবে

পরীক্ষিত Dhaka point request-এ API key ছাড়াই HTTP ২০০, `Access-Control-Allow-Origin: *`, `sources: MERRA2, POWER` পাওয়া গেছে। Official docs বলছে meteorological grid `0.5° latitude × 0.625° longitude` এবং solar data `1° × 1°`; daily weather ১৯৮১ থেকে প্রায় বর্তমান পর্যন্ত পাওয়া যায়। Daily endpoint UTC ও Local Solar Time—দুটিই দেয়; request-এ `time-standard=UTC` স্পষ্ট করে দিয়েছি।

Recent meteorological tail-এ GEOS-IT কম-latency data MERRA-2-এর পরে যুক্ত হয়; NASA POWER ২–৩ মাসের মধ্যে long-term MERRA-2-ভিত্তিক data দিয়ে tail update/replace করে। NASA trend analysis-এর জন্য near-real-time-এর প্রায় দুই মাস আগ পর্যন্ত থামানোর পরামর্শ দেয়। বারবার একই grid cell fetch করলে service block করতে পারে; grid cell cache ও request deduplication ব্যবহার করুন।

**রায়:** সহজ daily temperature/precipitation/solar fallback ও অঞ্চলভিত্তিক exploratory analysis-এর জন্য উপযোগী। ERA5-এর সমমানের resolution নয়; UI-তে data source, grid scale, UTC/LST এবং recent-tail caveat প্রকাশ না করে climate baseline হিসেবে ব্যবহার করবেন না।

## Direct access, license ও CORS-এর পার্থক্য

- **No API key মানেই CORS নয়।** CHIRPS/CHIRTS static files public হলেও tested data server `Access-Control-Allow-Origin` দেয়নি।
- **CORS মানেই key-free নয়।** NOAA CDO v2 test token ছাড়া HTTP ৪০০ দিলেও response-এ `ACAO: *` ছিল।
- **Public data মানেই gap-free বা homogenized নয়।** GHCN station coverage অসম; reanalysis gap পূরণ করে, কিন্তু সেটি observation নয়।
- **Wildcard CORS হলো anonymous request-এর browser read permission**, credentialed request বা availability/quota-র প্রতিশ্রুতি নয়। এখানে GET-এর Origin/header test করা হয়েছে; নতুন source-এর app-স্তরের Chromium flow এখনো যাচাই করা হয়নি।
- Copernicus CDS-এ ERA5 dataset open/CC-BY হলেও direct download-এর আগে user login, terms acceptance এবং API identity/public key লাগে—তাই এখানে no-key route হিসেবে গণনা করা হয়নি।
- NOAA GHCNh metadata CC0 এবং SSOD v2 dataset metadata-তে open data/no use restriction বলা হয়েছে—দুটির ক্ষেত্রেই NOAA/NESDIS/NCEI-কে cite করুন। NOAA NODD-এর GHCN AWS registry-ও CC0 public-domain distribution বলে; NOAA unaltered data-র attribution চায় এবং endorsement বোঝানো নিষেধ।
- Meteostat-এর license CC BY 4.0 attribution চায়; source/provider field ও upstream attribution রাখুন। GSOD-এর legacy readme-তে non-U.S. data-র non-commercial restriction রয়েছে। GHCN-M QCF-এর redistribution wording এই পর্বে আলাদাভাবে নিশ্চিত করা হয়নি; deployment-এর আগে readme/license পুনরায় দেখুন। CHIRPS v3 page public-domain/CC BY 4.0 শর্ত উল্লেখ করে। Open-Meteo-র বর্তমান pricing/terms deployment-এ আবার যাচাই করুন।

## Maps app-এ ভবিষ্যতে যোগ করার আগে প্রস্তাবিত ক্রম

1. Existing ERA5/ERA5-Land-কে global continuous historical analysis ও long-term climate baseline-এর default রাখুন; Historical Forecast (GFS/ICON/GRAPES) আলাদা archive হিসেবেই থাকুক। Station observation-কে reanalysis/forecast-এর সঙ্গে একই uninterrupted series করবেন না।
2. **Daily station data:** সহজ global daily synoptic summary চাইলে SSOD v2 দিয়ে ছোট prototype করুন; local climatological-day Tmax/Tmin/precipitation-কে অগ্রাধিকার দিলে GHCN-Daily আলাদা করে ব্যবহার করুন। NCEI bbox Search → কাছের একাধিক station rank (distance + requested element/year-এর Search coverage + end date) → নির্বাচিত variable/date Access Data query। Search-এর coverage actual non-missing value নয়—প্রাপ্ত row-এর sentinel/flag গুনে নিজের completeness হিসাব করুন।
3. **Hourly observation:** GHCNh-তে Search দিয়ে available station/file ও freshness খুঁজে, Data Service-এ শুধু প্রয়োজনীয় element/time chunk আনুন। `DATE` এবং প্রাসঙ্গিক quality/source/report fields explicit চাইুন; UTC timestamp, irregular reporting, duplicates, empty 200, 503 এবং retry budget সামলান। একবারে বহু বছরের/বড় station-year file browser-এ download করবেন না।
4. **Monthly climate trend:** GHCN-M v4 QCF-কে separate experimental layer হিসেবে test করুন; QCF-flagged adjusted monthly values-ই climate-trend view-তে ব্যবহার করুন। Worker-এ version/record-width/order validation, byte-range binary search, 1.93 MB inventory cache ও IndexedDB range-result cache; Range browser CORS/preview-origin-এ verify না হওয়া পর্যন্ত feature flag-এর আড়ালে রাখুন।
5. **Meteostat** রাখলে secondary source হিসেবে label দিন; `*_source` fields ধরে observed provider-এ filter এবং DWD MOSMIX/current-year future forecast-কে forecast archive-এ পাঠান—historical observation timeline-এ নয়। Global `stations.db` প্রতিটি user session-এ download করবেন না।
6. Station chart-এ station ID/name, distance, source dataset, UTC/local-day convention, element start/end, valid-day count, missingness, latest valid observation ও fetch timestamp দেখান। Missing value কখনো zero নয়; cross-source gap fill/splice নয়।
7. UI-র **একটি unified timeline** বজায় রাখুন: historical reanalysis, station observation, monthly homogenized series এবং forecast archive একই time ruler-এ থাকতে পারে, কিন্তু source/type স্পষ্টভাবে আলাদা থাকবে। Satellite layer চাইলে existing layer selector-এ থাকবে—**আলাদা satellite toolbar button নয়**।
8. Worker-এ CSV/PSV parsing, gzip decompression, sentinel/flag cleaning, date alignment, aggregation ও rendering-এর জন্য downsampling; IndexedDB-তে `(dataset, station, date-range, variables, version)` key-তে response/result cache। `AbortController`, stale-request cancellation, request deduplication, capped concurrency, exponential retry ও no-data/error/empty-body validation ব্যবহার করুন। CHIRPS/CHIRTS raw global file-এর বদলে CORS-সক্ষম approved subset service ছাড়া সরাসরি pixel download করবেন না।

## Primary references

- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) · [Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api) · [Pricing/terms](https://open-meteo.com/en/pricing)
- [NCEI Search Service docs](https://www.ncei.noaa.gov/support/access-search-service-api-user-documentation) · [NCEI Access Data Service docs](https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation) · [NCEI GHCN-Daily product page](https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily) · [NOAA GHCN-D AWS registry/license](https://registry.opendata.aws/noaa-ghcn/)
- [NOAA GHCNh product page](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly) · [GHCNh documentation PDF](https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh_DOCUMENTATION.pdf) · [GHCNh station list](https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh-station-list.txt) · [GHCNh metadata/license (CC0)](https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ncdc:C01688/html)
- [NOAA LCDv2 product page](https://www.ncei.noaa.gov/products/land-based-station/local-climatological-data) · [LCDv2 documentation PDF](https://www.ncei.noaa.gov/oa/local-climatological-data/v2/doc/lcdv2_DOCUMENTATION.pdf) · [LCDv2 dataset metadata/citation](https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ncdc:C01689/html)
- [NOAA SSOD v2 product explanation](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly/synoptic-summary-of-the-day) · [SSOD v2 Search dataset metadata/files](https://www.ncei.noaa.gov/access/search/datasets/synoptic-summary-of-the-day-v2/) · [SSOD v2 access directory](https://www.ncei.noaa.gov/oa/synoptic-summary-of-the-day/index.html#v2/)
- [NCEI OS upgrade/end-of-life notice (GSOD, 2025-08-29)](https://www.ncei.noaa.gov/operating-system-upgrade-outage) · [GSOD historical readme/terms](https://www.ncei.noaa.gov/data/global-summary-of-the-day/doc/readme.txt)
- [GHCN-M monthly official product page](https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-monthly) · [GHCN-M v4 temperature access directory](https://www.ncei.noaa.gov/data/global-historical-climatology-network-monthly/v4/temperature/access/) · [GHCN-M v4 readme](https://www.ncei.noaa.gov/pub/data/ghcn/v4/readme.txt) · [GHCN-M v4 temperature algorithm document](https://www.ncei.noaa.gov/pub/data/ghcn/v4/documentation/CDRP-ATBD-0859%20Rev%201%20GHCN-M%20Mean%20Temperature-v4.pdf)
- [NCEI GSOM dataset search](https://www.ncei.noaa.gov/access/search/datasets/global-summary-of-the-month/) · [GSOM data directory](https://www.ncei.noaa.gov/data/global-summary-of-the-month/access/)
- [Meteostat daily timeseries/bulk documentation](https://dev.meteostat.net/data/timeseries/daily) · [Meteostat weather-station metadata](https://dev.meteostat.net/data/weather-stations) · [License](https://meteostat.net/en/about/license) · [Terms of Use](https://meteostat.net/en/terms)
- [NOAA CDO v2 token docs](https://www.ncdc.noaa.gov/cdo-web/webservices/getstarted)
- [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) · [POWER data sources/resolution](https://power.larc.nasa.gov/docs/methodology/data/sources/) · [POWER trend-tail guidance](https://power.larc.nasa.gov/docs/methodology/)
- [CHIRPS v3 official page](https://www.chc.ucsb.edu/data/chirps3) · [CHIRPS v3 daily methodology readme](https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/readme.txt) · [CHIRPS v2 transition notice](https://www.chc.ucsb.edu/data/chirps)
- [CHIRTS-ERA5 official page](https://www.chc.ucsb.edu/data/chirts-era5)
- [Copernicus ERA5 CDS access](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-complete?tab=d_download)
- [NASA GIBS API docs](https://nasa-gibs.github.io/gibs-api-docs/) · [OpenFreeMap service/attribution](https://openfreemap.org/)
