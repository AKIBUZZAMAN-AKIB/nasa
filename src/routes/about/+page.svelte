<script lang="ts">
	import { base } from '$app/paths';

	import SiteHeader from '$lib/components/trend/site-header.svelte';

	import { EARTH_SYSTEMS, VARIABLES } from '$lib/trend/catalog';

	const methods = [
		{
			name: 'Mann–Kendall trend test',
			what: 'Is there a monotonic upward or downward trend? Rank based, so it needs no normal distribution and resists outliers. Ties are corrected.',
			ref: 'Mann (1945) Econometrica 13:245; Kendall (1975) Rank Correlation Methods'
		},
		{
			name: 'Hamed–Rao modified Mann–Kendall (primary test)',
			what: 'Climate series remember last year (autocorrelation), which makes the plain test too confident. This version inflates the variance by the effective sample size, using the significant autocorrelations of the detrended ranks.',
			ref: 'Hamed & Rao (1998) J. Hydrology 204:182–196'
		},
		{
			name: 'Trend-free pre-whitening (TFPW)',
			what: 'A second autocorrelation check: remove the trend, remove the lag-1 autocorrelation, add the trend back, then test again.',
			ref: 'Yue, Pilon, Phinney & Cavadias (2002) Hydrol. Processes 16:1807'
		},
		{
			name: "Sen's slope with a 95% confidence interval",
			what: 'How much per decade? The median of all pairwise slopes, robust to outliers. The interval comes from the Mann–Kendall variance.',
			ref: 'Sen (1968) JASA 63:1379; Gilbert (1987) Statistical Methods for Environmental Pollution Monitoring'
		},
		{
			name: 'Pettitt change-point test',
			what: 'When did the major change occur? Finds the year where the series splits into two parts with the most different levels, with an approximate p-value.',
			ref: 'Pettitt (1979) Applied Statistics 28:126–135'
		},
		{
			name: 'Segmented (two-phase) regression',
			what: 'Did the change speed up or slow down? Compares one straight line with two joined at the best year, using the Bayesian information criterion (BIC). The app reports a change in rate (for example "after 2014: rapid increase") only when two segments clearly beat one line; otherwise it reports a Pettitt shift in level, if significant.',
			ref: 'Schwarz (1978) Ann. Statist. 6:461; Kass & Raftery (1995) JASA 90:773 (\u0394BIC > 6 = strong)'
		},
		{
			name: 'Benjamini–Hochberg false discovery rate',
			what: 'The map tests every grid cell. With many tests some look significant by chance, so cell p-values are adjusted to keep the expected share of false discoveries at 5%.',
			ref: 'Benjamini & Hochberg (1995) JRSS B 57:289; Wilks (2016) BAMS 97:2263'
		},
		{
			name: 'Autocorrelation-adjusted association',
			what: 'Do two variables change together? Pearson correlation of the detrended series (so shared trends do not inflate it) with an effective sample size from the lag-1 autocorrelations, plus Spearman rank correlation. Reported as association only.',
			ref: 'Bretherton et al. (1999) J. Climate 12:1990; Dawdy & Matalas (1964)'
		},
		{
			name: 'Dataset agreement and homogeneity check',
			what: 'Each result is compared with an independent dataset: year-to-year correlation, and whether the second trend has the same sign and significance. The difference between the two standardised series is also tested with Pettitt; a sharp jump there points to a change in how one dataset was made (an inhomogeneity), and the confidence drops to Low.',
			ref: 'Peterson et al. (1998) Int. J. Climatol. 18:1493 (homogeneity of climate series)'
		}
	];

	const liveCount = VARIABLES.filter((v) => v.dataset.live).length;
</script>

<svelte:head>
	<title>Methods and data · Earth System Trend Explorer by DIVERGENT</title>
</svelte:head>

<div class="bg-background text-foreground min-h-dvh">
	<SiteHeader current="about" />
	<main class="mx-auto max-w-3xl px-4 pt-6 pb-16 sm:px-6">
		<h1 class="text-2xl font-bold tracking-tight sm:text-3xl">How the Trend Explorer works</h1>
		<p class="text-muted-foreground mt-2">
			How can complex Earth observation data become reliable, understandable, evidence-based
			information about how Earth is changing? Choose an Earth system, a variable, a region and a
			time period, and the app answers six questions: what is changing, where, how much, when the
			major change occurred, whether it is statistically significant, and how reliable it is.
		</p>

		<h2 class="mt-8 text-xl font-semibold">From data to answer</h2>
		<ol class="mt-3 list-decimal space-y-2 pl-5">
			<li>
				<strong>Load</strong> monthly values for the region: NASA POWER grids and GPM IMERG are read live
				from NASA servers in your browser; datasets whose servers cannot be read from a web page are bundled
				as labelled samples.
			</li>
			<li>
				<strong>Aggregate</strong> to one value per year for the chosen season (means, or totals for rainfall).
				A mean needs at least three quarters of the months; a total needs all of them. Missing months
				are filled with the month's long-term average plus the season's anomaly, so a missing monsoon
				month cannot bias the mean.
			</li>
			<li><strong>Test</strong> the yearly series with the methods below.</li>
			<li>
				<strong>Judge reliability</strong> from significance, data coverage, record length and agreement
				with a second, independent dataset.
			</li>
			<li>
				<strong>Explain</strong> the result twice: in research language with all statistics, and in everyday
				language for farmers, students and citizens.
			</li>
		</ol>

		<h2 class="mt-8 text-xl font-semibold">Statistical methods</h2>
		<p class="text-muted-foreground mt-1 text-sm">
			All run in your browser (TypeScript, no server). Unit tests check them against the Python
			reference packages pymannkendall and SciPy.
		</p>
		<dl class="mt-3 space-y-4">
			{#each methods as m (m.name)}
				<div>
					<dt class="font-semibold">{m.name}</dt>
					<dd class="mt-0.5">{m.what}</dd>
					<dd class="text-muted-foreground mt-0.5 text-sm">{m.ref}</dd>
				</div>
			{/each}
		</dl>

		<h2 class="mt-8 text-xl font-semibold">Reading the reliability panel</h2>
		<ul class="mt-3 list-disc space-y-1.5 pl-5">
			<li>
				<strong>Significance:</strong> from the autocorrelation-corrected Mann–Kendall p-value. p &lt;
				0.01 is strong evidence, p &lt; 0.05 significant, p &lt; 0.10 weak.
			</li>
			<li>
				<strong>Data coverage:</strong> the share of the months needed that the dataset actually has.
			</li>
			<li>
				<strong>Dataset agreement:</strong> High when an independent dataset correlates at r ≥ 0.7 year
				to year and shows a trend of the same sign and significance; Low when it disagrees or the homogeneity
				check finds a jump.
			</li>
			<li>
				<strong>Confidence:</strong> combines the three with the record length. It is never High for a
				trend that is not significant or when the second dataset disagrees.
			</li>
		</ul>

		<h2 class="mt-8 text-xl font-semibold">Data</h2>
		<p class="text-muted-foreground mt-1 text-sm">
			{VARIABLES.length} variables across {EARTH_SYSTEMS.length} Earth systems; {liveCount} are loaded
			live, the others from bundled samples.
		</p>
		<div class="mt-3 overflow-x-auto">
			<table class="w-full min-w-[34rem] text-left text-sm">
				<thead>
					<tr class="border-b">
						<th scope="col" class="py-2 pr-3">Variable</th>
						<th scope="col" class="py-2 pr-3">Dataset</th>
						<th scope="col" class="py-2 pr-3">Resolution</th>
						<th scope="col" class="py-2">Access</th>
					</tr>
				</thead>
				<tbody>
					{#each EARTH_SYSTEMS as s (s.id)}
						<tr
							><th
								colspan="4"
								scope="rowgroup"
								class="bg-muted px-2 py-1.5 text-xs font-semibold uppercase">{s.name}</th
							></tr
						>
						{#each VARIABLES.filter((v) => v.system === s.id) as v (v.id)}
							<tr class="border-b align-top">
								<td class="py-2 pr-3">{v.name}</td>
								<td class="py-2 pr-3">
									<a
										class="underline underline-offset-2"
										href={v.dataset.url}
										target="_blank"
										rel="noopener">{v.dataset.name}</a
									>
									<span class="text-muted-foreground block text-xs">{v.dataset.provider}</span>
								</td>
								<td class="py-2 pr-3">{v.dataset.resolution}</td>
								<td class="py-2">{v.dataset.live ? 'Live' : 'Sample'}</td>
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
		<p class="mt-3 text-sm">
			Independent comparison datasets: NOAA GHCN_CAMS station temperature, GPCP v2.3 precipitation,
			NOAA CPC soil moisture and NCEP reanalyses (NOAA PSL), and ECMWF ERA5 for tapped points (via
			Open-Meteo). Imagery: NASA GIBS (MODIS, SMAP).
		</p>
		<p class="text-muted-foreground mt-2 text-sm">
			SMAP soil moisture and GRACE groundwater need a NASA Earthdata login for their data files, so
			soil moisture comes from MERRA-2 and SMAP is shown as a GIBS map layer.
		</p>

		<h2 class="mt-8 text-xl font-semibold">Honest limitations</h2>
		<ul class="mt-3 list-disc space-y-1.5 pl-5">
			<li>
				<strong>Correlation is not causation.</strong> The app shows which variables change together,
				never why. A third factor can drive both.
			</li>
			<li>
				<strong>Satellite and model uncertainty.</strong> MERRA-2 and ERA5 are reanalyses (models constrained
				by observations); satellite products change sensors over time. The agreement and homogeneity checks
				flag some of this, not all.
			</li>
			<li>
				<strong>Autocorrelation.</strong> Handled with Hamed–Rao and pre-whitening, but short records
				(under about 20 years) stay uncertain.
			</li>
			<li>
				<strong>Change points are statistical.</strong> A change point is where the data shift most, not
				proof of an event in that year.
			</li>
			<li>
				<strong>Resolution.</strong> 0.5° grids (about 55 km) blur local detail; sample datasets cover
				a few sites, not every pixel.
			</li>
			<li>
				<strong>Machine learning</strong> could rank which variables best explain a change; this version
				keeps to transparent statistics so every number can be checked.
			</li>
		</ul>

		<h2 class="mt-8 text-xl font-semibold">Team DIVERGENT</h2>
		<p class="mt-2">
			Built in Rajshahi, Bangladesh for the NASA Space Apps Challenge 2026 (challenge: Earth System
			Trend Detective), using the Space Apps Bangladesh NASA Data Resource Hub and NASA open data.
			The source code is on
			<a
				class="underline underline-offset-2"
				href="https://github.com/AKIBUZZAMAN-AKIB/nasa"
				rel="noopener">GitHub</a
			>.
		</p>
		<p class="mt-6">
			<a
				href={`${base}/`}
				class="inline-flex min-h-11 items-center rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800"
				>Open the explorer</a
			>
		</p>
	</main>
</div>
