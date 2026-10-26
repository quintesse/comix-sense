<script lang="ts">
	import type { Bubble } from './types/Comic';
	import { cornerRadius, outlineColours } from './maskAppearance';
	let {
		bubble,
		disabled,
		onchange
	}: { bubble: Bubble; disabled: boolean; onchange: (changes: Record<string, string>) => void } =
		$props();
	const id = $props.id();
	type ScreenPicker = new () => {
		open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }>;
	};
	let screenPicker = $state<ScreenPicker>();
	let picking = $state(false);
	let pickError = $state('');
	let controller: AbortController | undefined;
	$effect(() => {
		screenPicker = (window as Window & { EyeDropper?: ScreenPicker }).EyeDropper;
	});
	$effect(() => {
		// Cancel an outstanding sample if its bubble or editing context goes away.
		bubble;
		disabled;
		return () => controller?.abort();
	});
	async function sample(key: string) {
		if (!screenPicker || disabled || picking) return;
		const selected = bubble;
		const request = new AbortController();
		controller = request;
		picking = true;
		pickError = '';
		try {
			const result = await new screenPicker().open({ signal: request.signal });
			if (!request.signal.aborted && bubble === selected && !disabled) {
				if (!/^#[\da-f]{6}$/i.test(result.sRGBHex)) throw new Error('Invalid sampled colour');
				onchange({ [key]: result.sRGBHex });
			}
		} catch (reason) {
			if (
				!request.signal.aborted &&
				!(reason instanceof DOMException && reason.name === 'AbortError')
			)
				pickError =
					'Could not pick a screen colour. Try again or use the colour picker or value field.';
		} finally {
			if (controller === request) {
				controller = undefined;
				picking = false;
			}
		}
	}
	let outlined = $derived(!!bubble.style?.stroke && bubble.style.stroke !== 'none');
	let radius = $derived(cornerRadius(bubble.style));
	let opacity = $derived(
		Number.isFinite(Number(bubble.style?.opacity))
			? Math.max(0, Math.min(1, Number(bubble.style?.opacity))) * 100
			: 80
	);
	function numeric(event: Event, key: string, scale = 1) {
		const input = event.currentTarget as HTMLInputElement;
		if (input.value !== '' && input.validity.valid && Number.isFinite(input.valueAsNumber))
			onchange({ [key]: String(input.valueAsNumber / scale) });
	}
	function colour(event: Event, key: string) {
		const input = event.currentTarget as HTMLInputElement;
		const valid = CSS.supports('color', input.value) || input.value === 'none';
		input.setCustomValidity(valid ? '' : 'Enter a valid CSS colour.');
		if (valid) onchange({ [key]: input.value });
	}
	function picker(value: string) {
		if (/^#[\da-f]{6}$/i.test(value)) return value;
		if (/^#[\da-f]{3}$/i.test(value)) return '#' + [...value.slice(1)].map((c) => c + c).join('');
		return '#000000';
	}
	function toggle(enabled: boolean) {
		if (!enabled) {
			if (bubble.style?.stroke && bubble.style.stroke !== 'none')
				outlineColours.set(bubble, bubble.style.stroke);
			onchange({ stroke: 'none' });
		} else {
			const setting = bubble.style?.['stroke-width'] ?? '';
			const width = parseFloat(setting);
			const remembered = outlineColours.get(bubble);
			onchange({
				stroke: remembered && CSS.supports('color', remembered) ? remembered : '#000000',
				...(!(width > 0 && Number.isFinite(width) && CSS.supports('stroke-width', setting))
					? { 'stroke-width': '2' }
					: {})
			});
		}
	}
</script>

<fieldset {disabled} aria-label="Mask appearance">
	<legend>Mask appearance</legend>
	<label for="{id}-radius">Corner radius (image px)</label>
	<div class="pair">
		<input
			aria-label="Corner radius slider (image px)"
			type="range"
			min="0"
			max={Math.max(100, radius)}
			step="0.5"
			value={radius}
			oninput={(e) => numeric(e, 'cornerRadius')}
		/><input
			id="{id}-radius"
			type="number"
			min="0"
			step="any"
			value={radius}
			oninput={(e) => numeric(e, 'cornerRadius')}
		/>
	</div>
	<p>Rounding can also soften speech-bubble tails.</p>
	{#snippet colourControl(key: string, label: string, fallback: string)}
		<label for="{id}-{key}">{label}</label>
		<div class="colour">
			<input
				aria-label="{label} picker"
				type="color"
				value={picker(bubble.style?.[key] ?? fallback)}
				oninput={(e) => colour(e, key)}
			/><input
				id="{id}-{key}"
				type="text"
				value={bubble.style?.[key] ?? fallback}
				oninput={(e) => colour(e, key)}
			/>
			<button
				type="button"
				aria-label="{label} eyedropper"
				title={screenPicker
					? `Pick ${label.toLowerCase()} from the screen (Esc to cancel)`
					: 'Screen colour picking is unavailable in this browser; use the colour picker or value field.'}
				disabled={!screenPicker || picking}
				onclick={() => sample(key)}
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					aria-hidden="true"
					><path d="m14 5 5 5 M13 6 4 15v5h5l9-9 M16 3l5 5-3 3-5-5z M4 20l-2 2" /></svg
				>
			</button>
		</div>
	{/snippet}
	{@render colourControl('fill', 'Fill colour', '#ffffff')}
	{#if !screenPicker}<p>
			Screen colour picking is unavailable; use the colour picker or value field.
		</p>{/if}
	{#if pickError}<p role="alert">{pickError}</p>{/if}
	<label class="toggle"
		><input
			type="checkbox"
			checked={outlined}
			onchange={(e) => toggle(e.currentTarget.checked)}
		/>Outline</label
	>
	{#if outlined}
		{@render colourControl('stroke', 'Outline colour', '#000000')}
		<label for="{id}-width">Outline width (image px)</label><input
			id="{id}-width"
			type="number"
			min="0"
			step="any"
			value={bubble.style?.['stroke-width'] ?? '1'}
			oninput={(e) => numeric(e, 'stroke-width')}
		/>
	{/if}
	<label for="{id}-opacity">Opacity (%)</label>
	<div class="pair">
		<input
			aria-label="Opacity slider (%)"
			type="range"
			min="0"
			max="100"
			step="1"
			value={opacity}
			oninput={(e) => numeric(e, 'opacity', 100)}
		/><input
			id="{id}-opacity"
			type="number"
			min="0"
			max="100"
			step="any"
			value={opacity}
			oninput={(e) => numeric(e, 'opacity', 100)}
		/>
	</div>
</fieldset>

<style>
	fieldset {
		border: 0;
		border-top: 1px solid #e0e0e0;
		margin: 1rem 0 0;
		padding: 0.75rem 0 0;
		min-width: 0;
	}
	legend {
		font-weight: 600;
	}
	label {
		display: block;
		margin: 0.5rem 0 0.25rem;
	}
	input {
		box-sizing: border-box;
		min-width: 0;
		width: 100%;
		padding: 0.375rem;
		font: inherit;
		color: inherit;
		background: #f4f4f4;
		border: 1px solid #8d8d8d;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 5rem;
		gap: 0.5rem;
	}
	.colour {
		display: grid;
		grid-template-columns: 2.5rem 1fr 2rem;
		gap: 0.5rem;
	}
	input[type='color'] {
		height: 2rem;
		padding: 0.125rem;
	}
	.toggle {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	input[type='checkbox'] {
		width: auto;
	}
	p {
		font-size: 0.75rem;
		color: #525252;
		margin: 0.375rem 0;
	}
	fieldset:disabled {
		opacity: 0.5;
	}
	button {
		display: grid;
		place-items: center;
		padding: 0.25rem;
		background: #f4f4f4;
		color: inherit;
		border: 1px solid #8d8d8d;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button:hover:enabled {
		background: #e0e0e0;
	}
	[role='alert'] {
		color: #da1e28;
	}
	button:focus-visible,
	input:focus-visible {
		outline: 2px solid #0f62fe;
	}
	input:invalid {
		border-color: #da1e28;
	}
</style>
