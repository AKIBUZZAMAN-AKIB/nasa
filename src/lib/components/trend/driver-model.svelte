<script lang="ts">
	import { variableById } from '$lib/trend/catalog';

	import type { DriverModel } from '$lib/trend/insights';

	interface Props {
		model: DriverModel;
		/** Everyday name of the target, e.g. 'monsoon rainfall'. */
		target: string;
		research: boolean;
	}

	let { model, target, research }: Props = $props();

	const rows = $derived(
		model.drivers.map((d) => {
			const v = variableById(d.id);
			return { ...d, name: v?.name ?? d.id, everyday: v?.everydayName ?? d.id };
		})
	);
	const helpful = $derived(rows.filter((r) => r.importance > 0.005));
	const pct = $derived(Math.max(0, Math.round(model.r2 * 100)));
	const maxImp = $derived(Math.max(...rows.map((r) => r.importance), 1e-9));

	const sentence = $derived.by(() => {
		if (model.skill === 'none' || !helpful.length)
			return `Together these variables do not predict the good and bad years of ${target} better than its long-term trend alone. Year-to-year swings here are driven by something else, or by chance.`;
		const top = helpful[0];
		const dir = top.coefficient >= 0 ? 'higher' : 'lower';
		const strength = model.skill === 'useful' ? 'help predict' : 'slightly help predict';
		return `These variables ${strength} the good and bad years of ${target}: about ${pct}% of the year-to-year swings, tested on years the model had not seen. ${top.everyday.charAt(0).toUpperCase() + top.everyday.slice(1)} matters most; years with more of it tend to have ${dir} ${target}.`;
	});
</script>

<div data-driver-model>
	<h4 class="text-sm font-semibold">
		Which variables help predict the ups and downs? (machine learning)
	</h4>
	<p class="mt-1 text-sm" data-driver-sentence>{sentence}</p>
	<ul class="mt-3 space-y-2.5" aria-label="Importance of each variable">
		{#each rows as r (r.id)}
			<li class="text-sm">
				<div class="flex flex-wrap items-baseline justify-between gap-x-3">
					<span class="font-medium">{r.name}</span>
					<span class="text-muted-foreground tabular-nums">
						{#if r.importance > 0.005}
							{Math.round(r.share * 100)}% of the skill · {r.coefficient >= 0
								? 'moves with'
								: 'moves against'}
						{:else}
							no added skill
						{/if}
					</span>
				</div>
				<div class="bg-muted mt-1 h-2 overflow-hidden rounded-full" aria-hidden="true">
					<div
						class="h-full rounded-full"
						style={`width:${(r.importance / maxImp) * 100}%;background:${r.coefficient >= 0 ? 'var(--trend-main)' : 'var(--trend-line)'}`}
					></div>
				</div>
			</li>
		{/each}
	</ul>
	<p class="text-muted-foreground mt-3 text-xs">
		{#if research}
			Ridge regression (λ = {model.lambda}) on detrended, standardised yearly values, scored by
			leave-one-year-out cross-validation against a trend-only forecast: R² = {model.r2.toFixed(2)} on
			{model.n} years. Importance is the drop in cross-validated R² when a variable is left out. Detrending
			first means a shared long-term trend earns no credit.
		{:else}
			How it works: the model learns from all years but one, guesses the missing year, and repeats
			for every year. Long-term trends are removed first, so two things rising together does not
			count.
		{/if}
		A good predictor is not proof of a cause.
	</p>
	<p class="text-muted-foreground mt-1 text-xs" data-driver-caveat>
		All variables are measured over the same months, so a variable can predict {target} because it responds
		to it (wet soil after a rainy season, for example), not because it drives it.
	</p>
</div>
