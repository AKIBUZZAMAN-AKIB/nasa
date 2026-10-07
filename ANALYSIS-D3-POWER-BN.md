# Historical analysis UI-তে NASA POWER সংযোজন + D3.js ভিজ্যুয়ালাইজেশন

> **অবস্থা:** কাজ শেষ এবং যাচাই করা হয়েছে।
> - `svelte-check`: ০টি error, ০টি warning
> - `vitest`: ১৭টি ফাইলে ৩৮৬টি test পাস করেছে, এর মধ্যে নতুন test ৩৩টি
> - `eslint` পরিষ্কার, `npm run build` সফল
> - আসল Chromium-এ ৭টি ট্যাবই চালিয়ে স্ক্রিনশট নেওয়া হয়েছে: `docs/analysis-ui/`

---

## ১. কী যোগ হলো (সংক্ষেপে)

| বিষয় | আগে | এখন |
|---|---|---|
| ডেটা উৎস | শুধু Open-Meteo (ERA5 পরিবার) | **NASA POWER** (ডিফল্ট) এবং Open-Meteo, টগল করে বদলানো যায় |
| POWER প্যারামিটার | Analysis-এ ছিল না | NASA-র **লাইভ ক্যাটালগ** থেকে আসে: Daily-তে ১৫০টি, Monthly-তে ১৩৮৮টি (AG/RE/SB কমিউনিটি)। সার্চ করা যায়, ধরন অনুযায়ী গ্রুপ করা |
| ভিজ্যুয়ালাইজেশন | হাতে লেখা ছোট SVG | **D3.js v7**: ৮টি D3 চার্ট কম্পোনেন্ট (১২টির বেশি ভিউ), টুলটিপ, ব্রাশ-জুম, SVG এক্সপোর্ট |
| ট্যাব | Annual / Series / Anomaly | **Overview · Series · Seasonal · Anomaly · Distribution · Compare · Spatial** |
| ট্রেন্ড পরিসংখ্যান | দৈনিক ডেটায় OLS, তাই p-value অবাস্তব রকম ছোট আসত | বার্ষিক মানে OLS, **autocorrelation-সংশোধিত p** (Santer 2000), Mann-Kendall/Sen এবং **Pettitt change-point** |
| তুলনা | ছিল না | **POWER ↔ ERA5 Compare**: bias, r, RMSE, দুটো উৎসের ট্রেন্ড, এবং difference series-এ step test |
| স্থানিক বিশ্লেষণ | ছিল না | **POWER regional grid**: প্রতিটি সেলের ট্রেন্ড ও change-point-এর ম্যাপ, যা মূল ম্যাপের ওপরেও দেখানো যায় |
| এক্সপোর্ট | ছিল না | Annual/Monthly CSV, এবং প্রতিটি চার্ট SVG হিসেবে |

---

## ২. গবেষণা থেকে নেওয়া মূল সিদ্ধান্ত

### ২.১ NASA POWER API-এর বাস্তব সীমা (লাইভ পরীক্ষায় নিশ্চিত)
- **একটি point request-এ পুরো রেকর্ড পাওয়া যায়।** ১৯৮১–২০২৫ সালের ১টি প্যারামিটারের দৈনিক ডেটা (১৬,৪৩৬টি মান) একবারে আসে, সময় লাগে ~০.৪ সেকেন্ড।
  - তাই প্রতিটি `community + temporal + code + location` একবারই আনা হয় এবং cache করা হয়।
  - পিরিয়ড বা বেসলাইন বদলালে নতুন request যায় না, শুধু client-side-এ slice হয়।
- **Community অবশ্যই cache key-তে থাকতে হবে।** AG আর RE কমিউনিটিতে ৩৫টি রেডিয়েশন প্যারামিটারের একক আলাদা (MJ/m²/day বনাম kWh/m²/day)।
- **Calculated প্যারামিটার বাদ।** PSC ও WSC-এর জন্য অতিরিক্ত ইনপুট লাগে, তাই এগুলো বাদ দেওয়া হয়েছে (১৫২ → ১৫০)।
- **`time-standard=utc` ব্যবহার করা হয়েছে।** IMERG-এর জন্য এটা বাধ্যতামূলক, আর এতে ERA5 (timezone=UTC)-এর দিনের সঙ্গে দিন মেলে।
- **Monthly ডেটার ১৩তম মাস (`YYYY13`) বাদ।** এটা আসলে বার্ষিক মান; বার্ষিক মান আমরা নিজেরাই completeness নিয়ম মেনে আবার হিসাব করি।
- **Regional request-এর সীমা:**
  - ১টি প্যারামিটার এবং অক্ষপ্রতি ≤১০°; ১১° দিলে HTTP 422।
  - দৈনিক regional ডেটা ≤৩৬৬ দিনের বেশি দেওয়া যায় না।
  - তাই দীর্ঘমেয়াদি স্থানিক ট্রেন্ডের জন্য **monthly regional** ব্যবহার করা হয়েছে। গ্রিড 0.5° × 0.625°; ৬° বক্সে ১২০টি সেল আসে, সময় লাগে ~০.৫ সেকেন্ড।
- **রেকর্ড শুরুর বছর:**
  - আবহাওয়া (MERRA-2): ১৯৮১
  - সৌর (SRB→CERES): **১৯৮৪**
  - IMERG বৃষ্টিপাত: **২০০১**
  - Panel নিজেই এই সীমার মধ্যে পিরিয়ড clamp করে।

### ২.২ Aggregation-এর নিয়ম: চার ধরন (লাইভ ডেটায় যাচাই)
POWER-এর সব প্যারামিটার একইভাবে যোগ বা গড় করা যায় না। তাই চারটি ধরন রাখা হয়েছে:

| ধরন | উদাহরণ | মাসিক/বার্ষিক হিসাব |
|---|---|---|
| `mean` | T2M, RH2M, WS10M, ALLSKY… | গড় (বার্ষিক মানের ক্ষেত্রে মাসের দিনসংখ্যা দিয়ে weighted) |
| `rate` | PRECTOTCORR, IMERG_PRECTOT, EVLAND, PRECSNO (mm/day) | দৈনিক মান যোগ করে মোট। Monthly POWER-এর মান **mm/day গড়**, তাই সেটাকে মাসের দিনসংখ্যা দিয়ে গুণ করা হয় |
| `count` | CDD*/HDD*/GDD* (degree-day), FROST_DAYS, `*_SUM` | যোগ। Monthly মান **আগে থেকেই মাসিক মোট** |
| `circular` | WD2M/WD10M/WD50M | ভেক্টর গড় (350° আর 10°-এর গড় 0°, 180° নয়) |

যাচাই:
- ২০২০-এর জুলাইয়ে POWER `PRECTOTCORR` = 14.58 mm/day, আর `PRECTOTCORR_SUM` = 451.9 mm।
- আমাদের হিসাব: 14.58 × 31 = 451.98 ✔।
- ২০২০ সালের বার্ষিক মোট: আমাদের 2866.5 mm, POWER-এর নিজের হিসাবে 2866.9 ✔।

**Completeness:**
- মাসের ≥৮০% নমুনা থাকলে মাসটি সম্পূর্ণ ধরা হয়।
- বছরকে সম্পূর্ণ ধরতে **১২টি মাসই** সম্পূর্ণ হতে হবে।
- অসম্পূর্ণ বছর চার্টে ফাঁপা বিন্দু হিসেবে দেখায়, কিন্তু পরিসংখ্যান থেকে বাদ পড়ে।

### ২.৩ পরিসংখ্যান পদ্ধতি এবং কেন
1. **ট্রেন্ড শুধু বার্ষিক মানে।** দৈনিক OLS-এ seasonal cycle আর autocorrelation থাকায় p-value অবাস্তব আসে। আগে Dhaka-র POWER Tmax-এ p=9e-137 দেখাত।
2. **Santer et al. (2000) effective sample size:** n_eff = n(1−r₁)/(1+r₁), df = n_eff−2। এর সঙ্গে ৯৫% CI দেখানো হয়।
   - Dhaka-র T2M-এ r₁=0.45, n_eff=17।
   - ফলে naive p=1.3e-5 থেকে **সংশোধিত p=0.010** হয়।
3. **Mann-Kendall এবং Sen's slope:** non-parametric cross-check। Intercept-এর জন্য Conover-এর median পদ্ধতি।
4. **Pettitt (1979) change-point:**
   - সূত্র U_k = 2Σr_i − k(n+1); tie থাকলে average rank।
   - p ≈ 2·exp(−6K²/(n³+n²))।
   - চার্টে ধাপের আগের ও পরের গড় দেখায়। p<0.05 হলে সতর্কবার্তা আসে।
5. **ETCCDI-ধাঁচের extreme index (Zhang et al. 2011):**
   - তাপমাত্রার জন্য TX90p/TN10p-এর মতো হিসাব: বেসলাইনের প্রতিটি ক্যালেন্ডার-দিনের জন্য ±৭ দিনের window নিয়ে p90/p10 threshold।
   - বৃষ্টির জন্য R95p-এর মতো: বেসলাইনের wet-day p95-এর চেয়ে বেশি বৃষ্টির দিনের সংখ্যা।
6. **Distribution shift:** প্রথম এক-তৃতীয়াংশ বনাম শেষ এক-তৃতীয়াংশ। বৃষ্টির ক্ষেত্রে শুধু wet day (≥1 mm) ধরা হয়।
7. **LTTB downsampling (Steinarsson 2013):** ১৬k থেকে ৪০০k বিন্দু আঁকার সময় peak হারায় না, আর শুধু আসল নমুনাই ফেরত দেয়।
8. **সব min/max লুপ দিয়ে হিসাব।** `Math.min(...arr)` ব্যবহার করলে ২০০k-এর বেশি উপাদানে stack overflow হয়; সেই পুরোনো বাগ ঠিক করা হয়েছে।

### ২.৪ Svelte 5 + D3 প্যাটার্ন
- **দায়িত্ব ভাগ:**
  - Svelte দেখে container, প্রস্থ (`bind:clientWidth`) এবং reactive ইনপুট।
  - D3 `$effect`-এর ভেতরে `<svg>`-এর সব কিছু আঁকে: scale, axis, shape, transition, brush, Delaunay hover।
- **থিম:** D3 axis `currentColor` ব্যবহার করে, তাই light/dark থিম আপনাআপনি কাজ করে।
- **পারফরম্যান্স:** ভারী হিসাবগুলো `$derived`-এ রাখা, তাই শুধু যে ট্যাব খোলা আছে তার হিসাবই চলে।

---

## ৩. ৭টি ট্যাব: কী দেখায় (D3 চার্ট)

| ট্যাব | D3 চার্ট | বিশ্লেষণ |
|---|---|---|
| **Overview** | বার্ষিক line বা bar; OLS (লাল), Sen (বেগুনি ড্যাশ), Pettitt ধাপ ও দুই পর্বের গড় (কমলা) | Period summary; OLS ±CI, naive ও সংশোধিত p; MK z/p; change-point সতর্কতা; ডেটার উৎস ও সীমাবদ্ধতা |
| **Series** | Focus+context: নিচের overview-তে **brushX** দিয়ে জুম, LTTB, 30/365-দিনের moving mean, টুলটিপ | Sample stats: mean±SD, p5/p50/p95, min/max ও তার তারিখ |
| **Seasonal** | মাসিক climatology band (p10–p90, p25–p75, median, min/max) + নির্বাচিত বছরের লাইন; **Year×Month heatmap** (anomaly বা value) | বেসলাইনের তুলনায় প্রতিটি মাস |
| **Anomaly** | Anomaly bar (diverging রং) + ১১ বছরের running mean + **climate stripes** | সর্বোচ্চ ও সর্বনিম্ন ৫টি বছর, বেসলাইনের ওপরে কত বছর |
| **Distribution** | প্রথম বনাম শেষ এক-তৃতীয়াংশের density + median; ETCCDI exceedance bar ও Sen line | p10/p50/p90-এর পরিবর্তন; উষ্ণ বা ঠান্ডা (বা ভেজা) দিনের সংখ্যার ট্রেন্ড |
| **Compare** | বার্ষিক overlay; **difference bar** ও Pettitt; মাসিক **scatter**: বছর অনুযায়ী viridis রং, 1:1 লাইন, OLS; দৈনিক overlay ও brush | Annual/monthly-anomaly/daily r, bias, RMSE; দুই উৎসের Sen; difference-এর ট্রেন্ড ও step; স্বয়ংক্রিয় রায় |
| **Spatial** (POWER) | Grid heatmap (Sen / mean / change-point year / shift), p<0.05 হলে ডট, অবস্থান চিহ্ন, ক্লিক করলে সেই সেল বিশ্লেষণ হয়; **"Show on map"** | যত শতাংশ সেলে significant change-point আছে, অঞ্চলজুড়ে ধাপ থাকলে সতর্কতা |

**POWER ↔ ERA5 জোড়া (একক রূপান্তরসহ):**
- একই একক:
  - T2M ↔ temperature_2m_mean
  - T2M_MAX/MIN ↔ _max/_min
  - T2MDEW ↔ dew_point
  - T2MWET ↔ wet_bulb
  - RH2M ↔ relative_humidity
  - PRECTOTCORR / IMERG_PRECTOT ↔ precipitation_sum
  - WD10M ↔ wind_direction_dominant
  - CLOUD_AMT ↔ cloud_cover
- রূপান্তর লাগে:
  - WS10M / WS10M_MAX ↔ wind_speed: km/h ÷ 3.6
  - PS ↔ surface_pressure, SLP ↔ pressure_msl: hPa ÷ 10 (kPa)
  - ALLSKY_SFC_SW_DWN ↔ shortwave_radiation_sum: AG-তে একই একক, RE-তে ÷ 3.6
- GWETTOP ↔ soil_moisture: শুধু আকৃতি তুলনা করা যায় (index বনাম m³/m³)।

উল্টো দিকেও কাজ করে: Open-Meteo উৎস বেছে নিলে Compare ট্যাব POWER-এর সমতুল্য প্যারামিটার আনে।

---

## ৪. লাইভ end-to-end যাচাই (Dhaka 23.81°N, 90.41°E)

| মাপকাঠি | ফলাফল |
|---|---|
| POWER T2M, ১৯৮১–২০২৫ | 16,436টি মান, ০.৩৯ সেকেন্ড, উৎস MERRA2 |
| OLS ট্রেন্ড | **−0.234 ± 0.17 °C/দশক**; naive p 1.3e-5 → **সংশোধিত p 0.010** |
| Sen | −0.210 °C/দশক (MK p 4e-4) |
| Pettitt | **২০০০**, ধাপ −0.77 °C (p 1e-5) |
| ERA5 T2M Sen | **+0.205 °C/দশক** |
| POWER − ERA5 difference | ধাপ **২০০০**, **−1.21 °C**, p 6e-7 |
| দৈনিক r / মাসিক-anomaly r / বার্ষিক r | 0.94 / 0.51 / **−0.19** |
| Regional (৬°×৬°, ১২০টি সেল) | **৮০% সেলে** significant change-point; বেশিরভাগ ১৯৯৭ (৩০টি) ও ২০০০ (২২টি) সালে |
| বৃষ্টি (Open-Meteo উৎস) | ERA5 গড় 1953 mm/yr, Sen −46; POWER Sen +380; difference-এ ধাপ ২০০০ |

এই সংখ্যাগুলো আগের গবেষণা নথির (`nasa-power-historical-research-bn.md`) সঙ্গে হুবহু মেলে।

এবার Spatial ট্যাব নতুন প্রমাণ দিয়েছে:
- বাংলাদেশের ওপর POWER-এ significant **শীতলীকরণ** দেখা যায়, অথচ পাশের হিমালয় ও বঙ্গোপসাগরে উষ্ণায়ন।
- অঞ্চলজুড়ে প্রায় একই বছরে (১৯৯৭–২০০০) ধাপ আছে।
- এটা স্থানীয় জলবায়ুর পরিবর্তন নয়, **MERRA-2-এর ইনপুটে পরিবর্তনের ছাপ** (Reichle et al. 2017-এর সঙ্গে সঙ্গতিপূর্ণ)।
- Panel এটা নিজেই সতর্কবার্তা আকারে দেখায়।

---

## ৫. ফাইল-কাঠামো

```
src/lib/analysis/
  analysis-stats.ts   বিশুদ্ধ পরিসংখ্যান: aggregation, trend, Santer, Pettitt, ETCCDI, compare, LTTB
  sources.ts          POWER (catalog/point/regional/notes/queue/cache) + Open-Meteo adapter + ERA5 জোড়া
  spatial.ts          প্রতিটি সেলের Sen/MK/Pettitt
  analysis-map.ts     MapLibre-এ grid polygon overlay
src/lib/stores/analysis.ts           panel state; Compare/Spatial lazy-load হয়
src/lib/components/analysis/         D3 চার্ট (Svelte 5)
  d3-utils.ts  chart-card  annual-chart  series-chart  anomaly-chart  heatmap-chart
  seasonal-chart  distribution-chart  scatter-chart  spatial-chart
src/lib/components/history/historical-panel.svelte   নতুন panel (source toggle, picker, ৭টি ট্যাব)
src/lib/tests/analysis-stats.test.ts, analysis-sources.test.ts   ৩৩টি নতুন test
docs/analysis-ui/*.png               ৭টি ট্যাবের আসল ব্রাউজার স্ক্রিনশট
```

পরিবর্তিত ফাইল:
- `history-button.ts`: বাটনে ক্লিক করলেই ম্যাপ-সেন্টারে **সঙ্গে সঙ্গে লোড** হয়। আগের "প্যানেল খুললে কিছু লোড হয় না" বাগ ঠিক হয়েছে।
- `power-button.ts`: এক সময়ে একটিই panel খোলা থাকে।
- `archive.ts`: `scheduleArchiveRequest` ও `dailyAggregateFor` export করা হয়েছে, যাতে ERA5 তুলনার request একই rate-limit queue ব্যবহার করে।
- `package.json`: `d3@7.9`, `@types/d3`।

আগে চিহ্নিত বাগগুলোর অবস্থা:
- Math.min/max crash: ✔
- দৈনিক OLS p-value: ✔
- বায়ুর দিকের গাণিতিক গড়: ✔ (circular)
- বৃষ্টির একক (বার্ষিক মোট): ✔
- প্যানেল auto-load না হওয়া: ✔
- POWER attribution: ✔

---

## ৬. সীমাবদ্ধতা এবং পরবর্তী ধাপের পরামর্শ
- POWER hourly (২০০১-এর পর) এবং climatology endpoint analysis-এ যোগ করা হয়নি। দৈনিক ও মাসিক ডেটা থেকেই আমরা নিজেরা climatology হিসাব করি, যা বেশি নমনীয়।
- Pettitt-এর p-value asymptotic, তাই n<20 হলে সতর্কভাবে দেখতে হবে। চাইলে bootstrap যোগ করা যায়।
- Mann-Kendall-এ autocorrelation সংশোধন (Hamed-Rao) এখনো নেই; OLS-এ Santer সংশোধন আছে।
- Spatial ট্যাব শুধু POWER-এর জন্য। Open-Meteo-তে প্রতিটি সেলের জন্য আলাদা request লাগবে, যা rate limit-এ আটকে যাবে।
- SNHT বা Buishand test যোগ করলে homogeneity-র রায় আরও শক্ত হবে। BMD স্টেশনের ডেটা দিয়ে তৃতীয় তুলনাও করা যায়।

---

## ৭. তথ্যসূত্র
- NASA POWER API (temporal/regional সীমা): https://power.larc.nasa.gov/docs/services/api/
- NASA POWER ডেটার উৎস (MERRA-2, SRB→CERES, FLASHFlux, IMERG): https://power.larc.nasa.gov/docs/methodology/data/sources/
- POWER parameter manager (লাইভ ক্যাটালগ): https://power.larc.nasa.gov/api/system/manager/parameters
- Reichle, R. H. et al. (2017). Assessment of MERRA-2 land surface hydrology estimates. *J. Climate*: https://journals.ametsoc.org/doi/full/10.1175/JCLI-D-16-0570.1
- Santer, B. D. et al. (2000). Statistical significance of trends and trend differences in layer-average atmospheric temperature time series. *JGR* 105(D6), 7337–7356.
- Pettitt, A. N. (1979). A non-parametric approach to the change-point problem. *Applied Statistics* 28(2), 126–135. doi:10.2307/2346729
- Pettitt test-এর ব্যাখ্যা ও সীমা: https://www.tandfonline.com/doi/full/10.1080/02626667.2019.1632461
- Zhang, X. et al. (2011). Indices for monitoring changes in extremes based on daily temperature and precipitation data. *WIREs Climate Change* 2, 851–870 (ETCCDI)।
- Steinarsson, S. (2013). Downsampling Time Series for Visual Representation (LTTB), MSc thesis: https://skemman.is/bitstream/1946/15343/3/SS_MSthesis.pdf
- Hawkins, E. Climate stripes: https://showyourstripes.info
- D3.js v7: https://d3js.org (d3-scale, d3-shape, d3-axis, d3-brush, d3-array/bin, d3-delaunay, d3-scale-chromatic)
- Open-Meteo Historical Weather API: https://open-meteo.com/en/docs/historical-weather-api

---

# পর্ব ২: UI আরও উন্নত করা (গবেষণার ভিত্তিতে)

স্ক্রিনশট: `docs/analysis-ui/v2/`। সব একসঙ্গে দেখতে: `gallery.jpg`।

## ৮. গবেষণা: কোথা থেকে কী শিখলাম

| উৎস | যা শিখলাম | UI-তে যা করা হলো |
|---|---|---|
| [IPCC AR6 WGI Visual Style Guide](https://www.ipcc.ch/site/assets/uploads/2022/09/IPCC_AR6_WGI_VisualStyleGuide_2022.pdf) | তাপমাত্রার জন্য red–blue, বৃষ্টির জন্য brown–green diverging palette; রংকানা মানুষের জন্য নিরাপদ রং; **rainbow colormap নয়**; ক্রমিক মানের জন্য হালকা থেকে গাঢ় | Sequential palette-এ **turbo (rainbow) বাদ**, তাপমাত্রায় YlOrRd, অন্যগুলোতে viridis। Diverging RdBu/BrBG আগে থেকেই IPCC-সম্মত |
| [Okabe–Ito palette](https://scifigure.org/colorblind-friendly-palette) | ৮টি রং, রংকানা মানুষ (deuteranopia/protanopia) আলাদা করতে পারেন | সব লাইন-সিরিজের রং: POWER নীল `#0072B2`, ERA5 কমলা `#E69F00`, OLS `#D55E00`, Sen `#CC79A7`, change-point `#009E73` |
| [Copernicus Interactive Climate Atlas](https://www.ecmwf.int/en/newsletter/181/earth-system-science/copernicus-interactive-climate-atlas-tool-explore-regional) | ভেরিয়েবল থিম অনুযায়ী গ্রুপ করা (heat & cold, wet & dry…); টাইম-সিরিজে baseline পিরিয়ড ধূসর শেড; বাঁদিকে কন্ট্রোল প্যানেল | **১০টি থিমে** POWER প্যারামিটার ভাগ; annual chart-এ **baseline শেড**; বাঁদিকে ধাপে ধাপে কন্ট্রোল |
| [C3S Climate Pulse](https://climate.copernicus.eu/climate-pulse-tool-take-temperature-our-planet-glance) | ১৯৯১–২০২০ বেসলাইনের সঙ্গে তুলনা, বছর হাইলাইট, ডেটা ও চার্ট ডাউনলোড | বেসলাইন ডিফল্ট ১৯৯১–২০২০; Seasonal-এ বছর হাইলাইট; CSV ও SVG ডাউনলোড |
| [NOAA Climate at a Glance](https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/national/time-series) | দশকপ্রতি ট্রেন্ড, base period, বছরের **র‍্যাঙ্কিং** | KPI-তে "২০২৫: 33rd warmest of 45"; ট্রেন্ড প্রতি দশকে |
| ড্যাশবোর্ড গবেষণা ([UX Pilot](https://uxpilot.ai/blogs/dashboard-design-principles), [MadeGood](https://madegooddesigns.com/dashboard-design/)) | ওপরে ৩–৫টি বড় KPI, প্রতিটিতে sparkline ও তুলনা; **tabular figures**; কন্ট্রাস্ট ≥ 4.5:1; শুধু রং দিয়ে অবস্থা বোঝানো যাবে না | Overview-তে ৪টি KPI tile ও sparkline; পুরো প্যানেলে `tabular-nums`; status pill-এ আইকন ও লেখা দুটোই |
| [WAI-ARIA APG: combobox ও grouped listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/examples/listbox-grouped/) | `aria-activedescendant`, Up/Down/Home/End, Enter, Escape; ফোকাস করা অপশন দেখা যায় এমনভাবে স্ক্রল হবে | নতুন **ParameterPicker** এই প্যাটার্ন মেনে বানানো; ট্যাবগুলো `role=tablist`, ←/→/Home/End দিয়ে চলে |
| Ed Hawkins-এর [#ShowYourStripes](https://showyourstripes.info) | এক নজরে দীর্ঘমেয়াদি পরিবর্তন দেখানো | Overview-তে compact **climate stripes** ব্যান্ড, নিচে বেসলাইন চিহ্ন |

## ৯. কী বদলেছে

1. **এক বাক্যে মূল ফল (Overview-এর শুরুতে):**
   - উদাহরণ: "Temperature at 2 Meters has decreased by −0.21 °C/decade over 1981–2025 (MK p < 0.001, adjusted p = 0.010)।"
   - সঙ্গে সতর্কবার্তা: "A step change in 2000 … verify in Compare"।
2. **৪টি KPI tile:**
   - Period mean, সঙ্গে sparkline ও Sen লাইন।
   - Trend/decade, সঙ্গে ↘ তীর এবং significant বা not significant pill।
   - সর্বশেষ বছরের র‍্যাঙ্ক।
   - Homogeneity: "Step 2000 ⚠ check data" অথবা "No step ✓"।
3. **Climate stripes ব্যান্ড**, টুলটিপসহ।
4. **Annual chart-এ নতুন যা আছে:**
   - Baseline শেড।
   - Legend-এ সরাসরি মান: "OLS −0.234/dec · Sen −0.21/dec · Step 2000 (Pettitt)"।
5. **ParameterPicker** (আগের সাধারণ `<select>`-এর জায়গায়):
   - থিম আইকন ও রং, প্রতিটি প্যারামিটারের একক।
   - সার্চে র‍্যাঙ্কিং: exact code > prefix > name > definition।
   - মিল পাওয়া অংশ হলুদ `<mark>` দিয়ে চিহ্নিত।
   - থিম ফিল্টার চিপ।
   - কিবোর্ড দিয়ে পুরোটা চালানো যায়; টাইপ করা অক্ষর ম্যাপের শর্টকাটে যায় না।
   - Daily-র ১৫০টি ও Monthly-র ১৩৮৮টি প্যারামিটারের **একটিও "Other" গ্রুপে পড়েনি** (লাইভ ক্যাটালগে পরীক্ষা করা)।
6. **বাঁদিকের কন্ট্রোল এখন ৫টি ধাপে:** Source → Parameter → Period → Location → Export।
   - Period preset চিপ: Full record, Last 30 yrs, 1991–2020, 2001–now (CERES/IMERG যুগ)।
7. **ট্যাবে আইকন** এবং ARIA tabs কিবোর্ড নেভিগেশন।
8. **Spatial ট্যাবে KPI:**
   - ২৪টি সেলে মান বাড়ছে, ৬৩টিতে কমছে (মোট ১২০)।
   - Median ট্রেন্ড −0.098 °C/দশক।
   - ৮০% সেলে ধাপ (region-wide), সবচেয়ে বেশি ১৯৯৭ সালে (৩০টি সেল)।
   - Colour legend আর কাটা পড়ে না।
9. **কার্ড ও ডার্ক মোড:**
   - সাদা কার্ডে shadow দিয়ে স্তর বোঝানো।
   - অক্ষর বড় করা: axis 9 → 10 px।
   - Axis-এ "100.0" এর বদলে "100"।
   - ডার্ক মোডেও সব ঠিকমতো কাজ করে (স্ক্রিনশটে যাচাই করা)।
10. **ছোটখাটো সংশোধন:**
    - Adjusted p আগে লাল দেখাত (যেন ত্রুটি); এখন নিরপেক্ষ নীল, bold।
    - Community লেবেল ছোট করা হয়েছে।

## ১০. যাচাই
- `svelte-check`: ০টি error, ০টি warning। `eslint` পরিষ্কার।
- `vitest`: ১৭টি ফাইলে **৩৮৭টি test পাস** (নতুন: theme classifier test)।
- `npm run build` সফল। Production build Chromium-এ চালিয়ে ১১টি স্ক্রিনশট নেওয়া হয়েছে।

নতুন ফাইল:
- `components/analysis/parameter-picker.svelte`
- `components/analysis/stat-tile.svelte`
- `components/analysis/stripes-strip.svelte`
- `analysis/sources.ts`-এ `POWER_THEMES` ও `powerTheme()`
