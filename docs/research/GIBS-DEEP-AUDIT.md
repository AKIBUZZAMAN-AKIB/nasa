# NASA GIBS catalogue — গভীর অডিট

- **অডিটের তারিখ:** ২০২৬-১০-০৩
- **পরিধি:** চারটি সরকারি WMTS `/all` Capabilities, generated snapshot, Worldview ও CMR enrichment, projection/rendering পথ, snapshot freshness এবং production build।
- **কোড পরিবর্তন:** এই অডিটে application source পরিবর্তন করা হয়নি; নিচের findings ও প্রস্তাবগুলো audit-only।

## নির্বাহী সারাংশ

- অডিটের সময় live GIBS `/all` endpoint-এর layer ID-গুলোর union generated snapshot-এর সঙ্গে **হুবহু মিলে গেছে**: ৩,৩৪৩টির মধ্যে যোগ/বাদ ০। `/all`-এ Best Available, Standard এবং NRT—তিন flavor-ই থাকার কথা NASA-র নথিতে স্পষ্ট করা আছে। [GIBS Access Basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)
- ৩,২৭৬টি layer Web Mercator map-এ ব্যবহারযোগ্য: ৩,১০৩ raster WMTS, ১৭৩ vector layer NASA-র default-styled WMS raster পথে। বাকি ৬৭টি EPSG:3857-এ নেই; searchable থাকে, overlay হয় না।
- বিদ্যমান ২৯টি curated quick pick অক্ষত; Worldview link কেবল exact Worldview layer ID পাওয়া গেলেই আসে।
- সবচেয়ে স্পষ্ট metadata bug: ২,৮৩৯টি generated colormap link-ই v1.0-এ যাচ্ছে; NASA v1.0-কে legacy এবং v1.3-কে বর্তমান/default বলেছে। [GIBS Access Advanced Topics](https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/)
- Snapshot-এর `coverageStart` কিছু layer-এ archive-এর সত্যিকারের শুরু নয়। GIBS Capabilities সর্বোচ্চ সাম্প্রতিক ১০০টি time period দেখায়; একটি লাইভ উদাহরণে snapshot ২০২৪-০৭-১১ দেখালেও পূর্ণ `DescribeDomains` archive শুরু ২০১২-০১-১৭-এ। অ্যাপের live availability query স্বাভাবিক অবস্থায় পূর্ণ range আনে; ভুলটি মূলত loading/error fallback-এ প্রভাব ফেলে। [GIBS Access Basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)
- CMR Visualization API-তে অনেক `/STD` ও `/NRT` variant-এর অতিরিক্ত metadata পাওয়া যায়, যা বর্তমান generator ব্যবহার করে না। তবে CMR record-এর `ConceptIds` field এখানে placeholder—সেগুলো সরাসরি ব্যবহার করা যাবে না। [CMR Search API](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html)

## ১. লাইভ catalogue coverage

২০২৬-১০-০৩-এ চারটি Capabilities XML সরাসরি fetch ও parse করে snapshot-এর সঙ্গে তুলনা করা হয়েছে।

| WMTS projection         | Live layer | Snapshot-এর সঙ্গে ID মিল | 3857 map-এ অবস্থা                    |
| ----------------------- | ---------: | ------------------------ | ------------------------------------ |
| EPSG:3857               |      ৩,২৭৬ | সম্পূর্ণ                 | map source                           |
| EPSG:4326               |      ৩,২৭৬ | EPSG:3857-এর একই ID set  | metadata/availability ও native grid  |
| EPSG:3413               |        ৬৬৯ | সম্পূর্ণ                 | polar-only layer-এর একটি উৎস         |
| EPSG:3031               |        ৫৬৬ | সম্পূর্ণ                 | polar-only layer-এর একটি উৎস         |
| চার projection-এর union |  **৩,৩৪৩** | **০ added / ০ missing**  | ৩,২৭৬ renderable; ৬৭ projection-only |

Projection availability-র union-এ ২,৬৬৮টি layer শুধু 3857+4326-এ; ৫০৭টি চার projection-এই; ১০১টি 3857+4326+3413-এ; ৫৩টি শুধু দুই polar projection-এ; ৮টি শুধু 3413-এ; ৬টি শুধু 3031-এ। অর্থাৎ ৬৭টি projection-only layer-এর ৫৩টি দুই polar grid-এই আছে।

EPSG:3857 Capabilities-এ format বিভাজন: **২,৮৯৩ PNG, ২১০ JPEG, ১৭৩ MVT**। JPEG/PNG WMTS raster; MVT-গুলো `application/vnd.mapbox-vector-tile`—এগুলোকে image tile হিসেবে না পাঠিয়ে WMS raster করা হয়েছে। NASA-র নথিতে বলা আছে vector WMTS EPSG:3857-এ নেই; vector WMS-ও সরাসরি 3857-এ দেওয়া হয় না। নথিভুক্ত workaround হলো EPSG:4326 WMS endpoint-এ EPSG:3857 SRS/BBOX পাঠানো; WMS সেই vector-কে default style-এ raster করে। বর্তমান URL সেই পথ অনুসরণ করে। [GIBS Access Advanced Topics](https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/)

### সরাসরি tile/availability smoke checks

- একটি Standard raster variant (`AIRS_L2_Dust_Score_Day_v7_STD`) থেকে WMTS `image/png` এবং একটি curated true-colour layer থেকে `image/jpeg` পাওয়া গেছে।
- NASA-র উদাহরণের EPSG:4326 vector WMTS tile (MVT) HTTP 200 দিয়েছে; response `application/octet-stream` এবং `Content-Encoding: gzip`—অর্থাৎ compressed vector payload। EPSG:4326 WMS-এ EPSG:3857 BBOX দিয়ে একই শ্রেণির vector raster `image/png` এসেছে। এতে MVT-কে raster হিসেবে পাঠানো হচ্ছে না—এই নকশা নিশ্চিত হয়।
- REST ও KVP—দুই ধরনের `DescribeDomains` request-ই যাচাই করা হয়েছে; পূর্ণ temporal range-এ ফল মিলে গেছে। অ্যাপের স্বাভাবিক live availability request এই পূর্ণ-range পথ ব্যবহার করে।
- `ACTIVATE_HU-25_Falcon_Ozone`-এর valid `DescribeDomains` range-এর ২০২০-০২-১০ ও ২০২০-০২-১১ তারিখে WMS endpoint HTTP 200 দিলেও body ছিল OGC ServiceException XML; পরের কিছু valid date-এ একই layer `image/png` দিয়েছে। এটি NASA-র layer/date-নির্দিষ্ট source-side ব্যর্থতার লক্ষণ, ID বা URL-template mismatch নয়। কেবল HTTP status 200 দেখেই WMS tile সফল বলা যাবে না; content type-ও যাচাই করা দরকার।

## ২. Metadata coverage এবং searchable surface

### Worldview enrichment

বর্তমান Worldview config-এ ১,৩২৯টি layer key; এর মধ্যে **১,২৭৬টি exact ID** চার WMTS `/all` union-এ আছে। Generator exact ID-তেই join করে—তাই অন্য Worldview provider বা GIBS `/all`-এ অনুপস্থিত key catalogue-এ ঢোকে না। ১,২৭৬টির মধ্যে ১,১৭০টিতে source CMR product ID/metadata আছে; ৮০৩টিতে search tags আছে। Worldview config-এর `Last-Modified` ২০২৬-০৯-২৯; snapshot এই header এবং config build date সংরক্ষণ করে।

WMTS Capabilities-এ অডিটকৃত layer-গুলোর `ows:Abstract` ছিল না। সেই কারণে snapshot-এ abstract শূন্য থাকা একা parser bug নয়। তবে category/group/tag ব্যবহারযোগ্যতা uneven—অনেক layer-এর জন্য search মূলত identifier ও official title-নির্ভর। UI সব ৩,৩৪৩ layer-এর ওপর filter করে, কিন্তু এক query-তে সর্বোচ্চ ১০০টি row দেখায় এবং “refine the search” নির্দেশ করে; তাই এটি catalogue truncation নয়, result-display cap।

### CMR Visualization API: বড় enrichment সুযোগ, কিন্তু সাবধানতা জরুরি

`provider=ESDIS&page_size=2000` দিয়ে CMR Search API-তে একবারে ১,২৮৯টি Visualization UMM JSON record পাওয়া গেছে। UMM `Name` দিয়ে exact join করলে **১,০৬২টি unique WMTS ID** মেলে; এর মধ্যে **১,০৪৩টি `_STD`/`_NRT` variant**, যেগুলোর exact ID Worldview config-এ নেই। CMR Search API Visualization UMM JSON সমর্থন করে এবং `page_size` সর্বোচ্চ ২,০০০—তাই generator-এ প্রতি layer-এ আলাদা request না করেও enrichment পরীক্ষাযোগ্য। [CMR Search API](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html)

CMR record-এ অতিরিক্ত `Measurement`, `ScienceParameters`, `TemporalCoverage`, `WGS84SpatialCoverage`, `SourceDatasets`, `VisualizationLatency`, generation resolution/format ইত্যাদি পাওয়া যায়। কিন্তু:

- ১,২৮৯টির **প্রতিটিতে** `umm.ConceptIds`-এ `C9876543210-ABCDAAC` / placeholder title-shortname এসেছে—ওই field থেকে source product link বানানো নিরাপদ নয়।
- ১,১৫০ record-এ `meta.associations.collections` আছে। `SourceDatasets` ও association দুটোই থাকা ১,১৪৮ record-এর মধ্যে ১,১৪৭টির set হুবহু মেলে; একটি ব্যতিক্রম যাচাই দরকার।
- ১,২৮৯ record-এ ১,০৯২টি unique `umm.Name`; ১৪০টি name একাধিক CMR record-এ আছে (১৯৭টি অতিরিক্ত row)। নমুনায় একই GIBS ID-র উত্তর/দক্ষিণ/global CMR record-এর `native-id` আলাদা—তাই শুধু “latest revision” বেছে নেওয়ার বদলে প্রাসঙ্গিক metadata aggregate/validate করতে হবে।
- `umm.Description`-এ কোনো record-এই ব্যবহারযোগ্য description পাওয়া যায়নি—এগুলো `YET_TO_SUPPLY` placeholder।

অতএব CMR enrichment-এ exact `Name`/`StandardOrNRTExternalIdentifier` দিয়ে join, duplicate aggregation, এবং `ConceptIds` উপেক্ষা করে `meta.associations.collections`/`ProductMetadata.SourceDatasets` ক্রস-চেক করা উচিত। CMR-কে layer catalogue-এর উৎস না করে enrichment source হিসেবেই রাখা উচিত।

## ৩. অগ্রাধিকারভিত্তিক findings

### P1 — Colormap link legacy v1.0 বেছে নিচ্ছে

`scripts/update-gibs-catalog.py::metadata_links()`-এ `links.setdefault("colormapUrl", href)` metadata list-এর প্রথম colormap-কে রেখে দেয়। বর্তমান Capabilities XML-এ ক্রমটি v1.0, v1.3, তারপর unversioned/default alias; ফলে snapshot-এর **২,৮৩৯টি colormap URL-ই `/colormaps/v1.0/`**। NASA-র docs v1.0-কে legacy support এবং v1.3-কে latest/default বলে। [GIBS Access Advanced Topics](https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/)

**প্রভাব:** tile drawing নয়—WMS/WMTS server নিজস্ব default style-এ image বানায়। কিন্তু Details panel-এর “Color map” metadata link পুরোনো সংস্করণে যায় এবং নতুন metadata ব্যবহার/ব্যাখ্যার ক্ষেত্রে বিভ্রান্ত করতে পারে।

**সুপারিশ:** default/unversioned alias বা v1.3-কে অগ্রাধিকার দিন; চাইলে v1.0-কে legacy link হিসেবে আলাদাভাবে রাখুন; parser regression test যোগ করুন।

### P1 — `coverageStart` কখনও archive start নয়

`dimension_data()` Capabilities-এর প্রকাশিত Time `Value`-গুলোর minimum start-কে `coverageStart` করে। NASA স্পষ্টভাবে বলে Capabilities document-এ সাম্প্রতিক সর্বোচ্চ ১০০ period থাকে; পূর্ণ archive-এর জন্য `DescribeDomains`। [GIBS Access Basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)

লাইভ উদাহরণ: `VIIRS_SNPP_L3_NDVI_16Day_v2.0_STD` snapshot-এ `coverageStart=2024-07-11`; Capabilities-এ ১০০টি period-ই দেখা যায়। পূর্ণ `DescribeDomains` ৬৭৪টি period দিয়ে **২০১২-০১-১৭ → ২০২৬-০৯-০৬** দেখিয়েছে। আর TEMPO v4 layer-এ snapshot start `2026-09-25`, পূর্ণ start `2023-08-02T15:12:49Z`; response-এ ১৬,৬৭৪টি range (প্রায় ৮৫০ KB) ছিল।

**প্রভাব:** generator layer-কে ভুলভাবে ২০২৪ থেকে শুরু হয়েছে বলে বর্ণনা করতে পারে। অ্যাপের live DescribeDomains সফল হলে timeline-এ পূর্ণ ২০১২ থেকে দেখায়; `coverageStart` মূলত load/error fallback-এ ব্যবহৃত। কিন্তু ওই fallback-এ date picker ১২ বছরের বেশি পুরোনো data ঢেকে ফেলতে পারে।

**সুপারিশ:** এ মানকে `capabilitiesWindowStart`-এর মতো নামে সীমিত অর্থে রাখুন, এবং এটিকে সত্যিকারের archive start হিসেবে দেখাবেন না। True archive start কেবল full DescribeDomains/বিশ্বস্ত CMR temporal metadata থেকে নির্ধারণ করুন; live query ব্যর্থ হলে ভুল start দিয়ে user-কে clamp না করাই নিরাপদ।

### P2 — প্রতি projection-এর matrix set সম্পূর্ণ সংরক্ষিত নয়

Snapshot `availableProjections`-এ EPSG code list রাখে, কিন্তু `tileMatrixSet` একটিই—map-যোগ্য layer-এ EPSG:3857; `resolutionMatrixSet` সাধারণত EPSG:4326। অডিটে ৩,২৭৬টি common layer-এই EPSG:3857 ও EPSG:4326-এর matrix-set identifier আলাদা পাওয়া গেছে (যেমন `GoogleMapsCompatible_Level7` বনাম `1km`)। EPSG:3413/3031-এর matrix set/title-ও একই record-এ রাখা হয়নি; projection-only ৬৭টির মধ্যে ৫৩টি দুই polar projection-এ থাকলেও snapshot primary হিসেবে 3413 বেছে নেয়। পাশাপাশি 3413-এ ২২টি ও 3031-এ ২৮টি layer title primary snapshot title থেকে আলাদা।

**প্রভাব:** বর্তমান EPSG:3857 map rendering ঠিক; UI 3857 tile matrix ও resolution grid-ও দেখায়। কিন্তু চার WMTS service-এর প্রতিটি projection-এ layer কী matrix set ব্যবহার করে—এ তথ্য snapshot/UI থেকে সম্পূর্ণ পুনর্গঠন করা যায় না।

**সুপারিশ:** `projectionDetails: {epsg3857: {tileMatrixSet, formats, ...}, ...}` রাখুন বা অন্তত `projectionTileMatrixSets` map যোগ করুন। এতে ভবিষ্যৎ polar map, export, এবং full-metadata acceptance যাচাই সহজ হবে।

### P2 — CMR থেকে exact variant metadata এখনো ব্যবহার হচ্ছে না

বর্তমানে generator Worldview config-এ exact ID পাওয়া গেলেই subtitle/group/tag/product metadata যোগ করে। CMR Visualization query-তে ১,০৪৩টি exact `/STD`/`/NRT` ID পাওয়া গেছে যেগুলো Worldview exact-key join-এ নেই। এগুলোর ScienceParameters/measurement/temporal/source-dataset fields searchable metadata সমৃদ্ধ করতে পারে।

**সুপারিশ:** আগে non-writing prototype-এ CMR records-কে exact WMTS IDs-এর সঙ্গে join করে field coverage ও duplicate policy যাচাই করুন; তারপর snapshot-এ validated `scienceParameters`, `measurement`, `temporalCoverage` ও actual collection associations রাখুন। Placeholder `umm.ConceptIds` ব্যবহার করবেন না।

### P2 — WMS vector path-এ source-side intermittent error

`ACTIVATE_HU-25_Falcon_Ozone`-এর `DescribeDomains` valid বললেও কয়েকটি নির্দিষ্ট day-তে WMS `image/png` নয়, OGC exception XML ফেরত দিয়েছে। NASA নথি অনুযায়ী vector WMS default style-এ raster হয় এবং EPSG:3857-এর জন্য EPSG:4326 endpoint workaround-ই সঠিক পথ; তাই এই নির্দিষ্ট ব্যর্থতা endpoint design-এর বিরুদ্ধে নয়, upstream layer/date availability-এর সীমাবদ্ধতা। [GIBS Access Advanced Topics](https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/)

**সুপারিশ:** automated live check-কে nightly/non-blocking রাখুন; `image/*` content-type ও decode যাচাই করুন। user-facing error reporting-এ “available frame” আর “tile actually served” আলাদা রাখার কথা বিবেচনা করুন।

### P3 — Snapshot freshness ও bundle budget

- Generator নিরাপদে temporary file লিখে atomically replace করে এবং per-projection/union count guard আছে—ভালো safeguard।
- `package.json`-এ GIBS updater command নেই এবং `.github/workflows`-এ scheduled GIBS refresh/drift check নেই। Snapshot generatedAt শুধু তারিখ; Capabilities responses-এ অডিটের সময় ETag/Last-Modified পাওয়া যায়নি। Worldview Last-Modified আছে।
- Snapshot raw ৩,৯২৯,৯৩৯ bytes; gzip প্রায় ১৩৬,৭৪৮ bytes। Production build সফল হলেও Vite ১.৫ MB raw limit-এর বেশি client chunk warning দিয়েছে: বড় chunk প্রায় ৪.৯৪ MB raw / ৪৭৮ KB gzip।

**সুপারিশ:** সপ্তাহে/মাসে একবার scheduled catalogue comparison চালিয়ে ID/field drift হলে PR খুলুন; fixed expected-count test ছাড়াও projection-wise set comparison রাখুন। Startup bundle budget কঠোর হলে generated JSON-কে lazy catalogue chunk হিসেবে খোলার সময়ে load করার পরীক্ষা করুন। NASA GIBS docs HTTP/1.1 connection concurrency কমাতে `gibs-a/b/c` aliases/domain sharding-ও উল্লেখ করে; এটি কেবল tile-loading bottleneck দেখা গেলে পরীক্ষা করার optimization। [GIBS Access Advanced Topics](https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/)

## ৪. Live browser QA — Chromium

২০২৬-১০-০৩-এ Playwright-চালিত headless Chromium দিয়ে চালু Vite preview (`http://127.0.0.1:5173/?gibs-date=2026-10-02`) পরীক্ষা করা হয়েছে। এটি বাস্তব browser rendering/network path; তবে প্রতিটি ৩,৩৪৩ layer ও প্রতিটি তারিখের exhaustive পরীক্ষা নয়।

| Browser check              | ফল                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| অ্যাপ document             | HTTP 200; JavaScript page error ০                                                                                                                                                                          |
| GIBS default raster        | MODIS Terra True Color WMTS tile HTTP 200 `image/jpeg`; imagery browser canvas-এ render হয়েছে                                                                                                              |
| Catalogue                  | dialog-এ ৩,৩৪৩ official entry ঘোষণা; default quick-pick list-এ ঠিক ২৯টি row                                                                                                                                |
| Vector layer               | `VIIRS_NOAA20_Thermal_Anomalies_375m_All`-এর map status WMS raster; NASA WMS HTTP 200 `image/png`; কোনো `.mvt` tile request হয়নি                                                                           |
| Worldview/CMR details      | exact Worldview ID-যুক্ত vector layer-এ NASA Worldview button ও source-product label দেখা গেছে                                                                                                             |
| Date navigation            | Previous day-তে UI ২০২৬-১০-০২ → ২০২৬-১০-০১ হয়েছে; একই link reload করলেও UI ১ অক্টোবরেই ফিরেছে                                                                                                              |
| Projection-only            | `AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Polar` search-এ আছে; map-only filter করলে ০ result; নির্বাচন করলে “Not overlaid” banner; শুধু EPSG:3413 `DescribeDomains` XML গেছে, কোনো image tile নয় |
| Static layer               | date input নেই এবং static-layer message এসেছে; exact Worldview ID না থাকায় Worldview button-ও আসেনি                                                                                                        |
| Replay                     | panel খোলে এবং “satellite archive” mode ও range controls দেখায়                                                                                                                                             |
| Sub-daily + Dhaka timezone | Production preview-তে GOES-East ABI ১০-মিনিট layer-এ `06:40 UTC` → Next frame `06:50 UTC`; `step=600`, পরের PNG WMTS tile HTTP 200; replay-তে local-input/UTC-frame hint আছে                               |
| Mobile layout              | 390 px viewport-এ document horizontal overflow নেই; catalogue dialog 358 px wide, ২৯টি curated item ও search input দৃশ্যমান                                                                                |

এই browser session-এ GIBS host থেকে ৯৯টি response দেখা গেছে; ২৪টি JPEG ও ৭২টি PNG image response ছিল, এবং ওই session-এ HTTP status ৪xx/৫xx শূন্য। এটি sample runtime-এর ফল—আগের live audit-এ নির্দিষ্ট ACTIVATE date-এ HTTP 200 body-তে OGC ServiceException পাওয়া গিয়েছিল; সেটি সব date/layer সফল—এমন নিশ্চয়তা দেয় না।

### Browser-এ দেখা বাকি caveat

- **Forecast API, GIBS নয়:** একই browser পরিবেশে `data-spatial.open-meteo.com/.../dwd_icon/latest.json` ও `in-progress.json` HTTP 403 দিয়েছে। ফলে এই sandbox preview-তে Open-Meteo forecast overlay যাচাই করা যায়নি; GIBS raster/vector request আলাদাভাবে সফল হয়েছে।
- **Legend SVG:** NASA legend endpoint সরাসরি HTTP 200 ও `Access-Control-Allow-Origin: *` দিলেও app-এর dev response-এ `Cross-Origin-Embedder-Policy: require-corp` থাকায় default no-CORS `<img>` browser-এ block হয়েছে। নির্দিষ্ট legend থাকা layer-এর Details panel-এ legend image-টি তাই preview-তে দেখানো হয়নি। `crossorigin="anonymous"` দিয়ে CORS-mode image load, অথবা preview policy-র পরিবর্তন পরীক্ষা করা উচিত।
- **Share URL consistency:** previous-day action-এর পর date control ১ অক্টোবর হলেও address bar-এ `gibs-date=2026-10-02` থেকে গেছে, পাশাপাশি `time=2026-10-01T1200` এসেছে। Sub-daily Next frame-এও UI `06:50 UTC` হলেও `gibs-time=06:40:00Z`-এর সঙ্গে `time=...0650` ছিল। দৈনিক পরীক্ষায় reload-এর পর দৃশ্যমান তারিখ ঠিক ফিরেছে, কিন্তু URL-এর GIBS param ও app `time` param পরস্পরবিরোধী—URL sync পরিষ্কার করা উচিত।

## ৫. যাচাই ও সুপারিশকৃত পরবর্তী কাজ

**বর্তমান validation:**

- `npm test -- --run`: ১৪ test file, ৩৩৪ test passed।
- `npm run check`: ০ error, ০ warning।
- `npm run lint`: Prettier ও ESLint সফল।
- `npm run build`: সফল; শুধু non-fatal large-chunk warning।
- Live Capabilities union বনাম snapshot: ৩,৩৪৩ ID-তে exact match।

**পরের code pass-এর প্রস্তাবিত ক্রম:**

1. `syncGibsUrl`/clock URL update-কে serialize করে `gibs-date`/`gibs-time` এবং `time` query-গুলোকে পরস্পরের সঙ্গে মিলিয়ে রাখতে regression test যোগ।
2. Legend `<img>`-এ `crossorigin="anonymous"` পরীক্ষা/যোগ, অথবা preview COEP policy সামঞ্জস্য—browser-এ SVG legend block যেন না হয়।
3. Colormap metadata selector-এ v1.3/default preference ও generator regression test।
4. `coverageStart`-কে “Capabilities window start” হিসেবে স্পষ্ট করা; পূর্ণ start-এর fallback যেন ভুলভাবে layer history সীমাবদ্ধ না করে।
5. Per-projection matrix-set metadata যোগ।
6. CMR UMM enrichment-এর prototype ও safe join/dedup policy; এরপরই production snapshot-এ আনা।
7. Scheduled snapshot drift checker ও content-type-aware live tile smoke test।

## উৎস

- GIBS service flavor, Capabilities time-window ও DescribeDomains: [GIBS Access Basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)
- MVT বনাম WMS rendering, Web Mercator workaround, colormap versions ও domain sharding: [GIBS Access Advanced Topics](https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/)
- CMR Visualization UMM JSON ও paging: [CMR Search API](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html)
- WMS raster tile URL template-এ `{bbox-epsg-3857}` ব্যবহার: [MapLibre — Add a WMS source](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-wms-source/)
- GIBS acknowledgement: [NASA GIBS Introduction](https://nasa-gibs.github.io/gibs-api-docs/)
