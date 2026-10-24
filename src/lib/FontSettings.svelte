<script lang="ts">
	import { tick } from 'svelte';
	import type { Font, FontScope, Face } from './bbl/metadata';
	import FontFaces from './FontFaces.svelte';

	let {
		font = {},
		defaults = {},
		families = [],
		faces = [],
		faceKey = '',
		disabled = true,
		busy = false,
		scope = $bindable('page'),
		onchange,
		onfaceschange,
		onclose
	}: {
		font: Font;
		defaults: Font;
		families: string[];
		faces: Face[];
		faceKey: string;
		disabled: boolean;
		busy?: boolean;
		scope: FontScope;
		onchange: (font: Font) => Promise<void>;
		onfaceschange: (faces: Face[]) => Promise<void>;
		onclose: () => void;
	} = $props();
	const id = $props.id();
	let panel: HTMLDivElement;
	let handle: HTMLButtonElement;
	let familyInput: HTMLInputElement;
	let familyText = $state('');
	let draft = $state<Font>({});
	let error = $state('');
	let x = $state(0);
	let y = $state(72);
	let pointer: { id: number; x: number; y: number; left: number; top: number } | undefined;
	let revision = 0;
	$effect(() => {
		draft = { ...font };
		if (document.activeElement !== familyInput) familyText = font.family?.join(', ') ?? '';
		error = '';
	});
	$effect(() => {
		x = Math.max(0, window.innerWidth - 360);
		void tick().then(() => {
			clamp();
			handle?.focus({ preventScroll: true });
		});
	});
	function clamp() {
		x = Math.max(0, Math.min(x, window.innerWidth - (panel?.offsetWidth ?? 336)));
		y = Math.max(0, Math.min(y, window.innerHeight - (panel?.offsetHeight ?? 48)));
	}
	function start(event: PointerEvent) {
		if (event.button !== 0) return;
		event.preventDefault();
		handle.focus({ preventScroll: true });
		handle.setPointerCapture(event.pointerId);
		pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, left: x, top: y };
	}
	function move(event: PointerEvent) {
		if (!pointer || pointer.id !== event.pointerId) return;
		x = pointer.left + event.clientX - pointer.x;
		y = pointer.top + event.clientY - pointer.y;
		clamp();
	}
	function stop(event: PointerEvent) {
		if (pointer?.id !== event.pointerId) return;
		pointer = undefined;
		if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
	}
	function moveKey(event: KeyboardEvent) {
		const step = event.shiftKey ? 32 : 8;
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		if (event.key === 'ArrowLeft') x -= step;
		if (event.key === 'ArrowRight') x += step;
		if (event.key === 'ArrowUp') y -= step;
		if (event.key === 'ArrowDown') y += step;
		clamp();
	}
	async function update(key: keyof Font, value: Font[keyof Font] | undefined) {
		const next = { ...draft };
		if (value === undefined) delete next[key];
		else Object.assign(next, { [key]: value });
		draft = next;
		const current = ++revision;
		error = '';
		try {
			await onchange($state.snapshot(next));
		} catch (reason) {
			if (current === revision) error = 'Could not apply font settings: ' + String(reason);
		}
	}
	type NumberField = 'size' | 'weight' | 'lineHeight' | 'letterSpacing';
	const numberDefaults = { size: 24, weight: 400, lineHeight: 1, letterSpacing: 1 };
	function inheritedNumber(input: HTMLInputElement, key: NumberField) {
		function seed() {
			if (input.value !== '' || input.validity.badInput) return false;
			const inherited = defaults[key];
			const fallback = inherited === undefined || inherited === 0;
			input.value = String(fallback ? numberDefaults[key] : inherited);
			return fallback;
		}
		function firstValue(event: Event) {
			if (!seed()) return;
			// The first adjustment adopts the useful default; subsequent ones step normally.
			event.preventDefault();
			input.focus();
			void update(key, input.valueAsNumber);
		}
		function pointerdown(event: PointerEvent) {
			if (event.button === 0) firstValue(event);
		}
		function keydown(event: KeyboardEvent) {
			if (event.key === 'ArrowUp' || event.key === 'ArrowDown') firstValue(event);
		}
		function blur() {
			// Merely focusing an inherited value must not create an override.
			if (draft[key] === undefined) input.value = '';
		}
		input.addEventListener('pointerdown', pointerdown, true);
		input.addEventListener('keydown', keydown, true);
		input.addEventListener('blur', blur);
		return {
			destroy() {
				input.removeEventListener('pointerdown', pointerdown, true);
				input.removeEventListener('keydown', keydown, true);
				input.removeEventListener('blur', blur);
			}
		};
	}
	function numberInput(key: NumberField, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (!input.validity.valid) return;
		void update(key, input.value === '' ? undefined : input.valueAsNumber);
	}
	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		}
		// Form arrows and Space belong to the panel rather than the reader.
		if (['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key))
			event.stopPropagation();
	}
</script>

<svelte:window onresize={clamp} />

<div
	bind:this={panel}
	class="font-settings"
	role="dialog"
	tabindex="-1"
	aria-modal="false"
	aria-label="Font Settings"
	aria-busy={busy}
	data-font-settings
	style:left="{x}px"
	style:top="{y}px"
	style:max-height="calc(100dvh - {y}px - 8px)"
	onkeydown={keydown}
>
	<header>
		<button
			bind:this={handle}
			type="button"
			class="drag-handle"
			aria-label="Move Font Settings"
			title="Drag to move; use arrow keys when focused"
			onpointerdown={start}
			onpointermove={move}
			onpointerup={stop}
			onpointercancel={stop}
			onlostpointercapture={stop}
			onkeydown={moveKey}>Font Settings</button
		>
		<button
			type="button"
			class="close"
			aria-label="Close Font Settings"
			title="Close (Esc)"
			onclick={onclose}>×</button
		>
	</header>
	<div class="form">
		<label for="{id}-scope">Apply to</label>
		<select id="{id}-scope" bind:value={scope} disabled={busy}>
			<option value="album">Current album</option>
			<option value="page">Current page</option>
			<option value="bubble">Selected bubble</option>
		</select>
		{#if disabled}<p class="hint">
				{scope === 'bubble'
					? 'Select a bubble on the page to edit its font.'
					: 'Select a text overlay to edit its font.'}
			</p>{/if}
		<fieldset disabled={disabled || busy}>
			<label for="{id}-family">Font families</label>
			<input
				bind:this={familyInput}
				bind:value={familyText}
				id="{id}-family"
				type="text"
				list="{id}-families"
				placeholder={defaults.family?.join(', ') ?? 'Inherit'}
				oninput={(event) => {
					const names = event.currentTarget.value
						.split(',')
						.map((name) => name.trim())
						.filter(Boolean);
					void update('family', names.length ? names : undefined);
				}}
			/>
			<datalist id="{id}-families"
				>{#each [...new Set( [...families, 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'] )] as family}<option
						value={family}
					></option>{/each}</datalist
			>
			<p class="hint">Comma-separated families, in fallback order.</p>
			<div class="fields">
				<label
					>Size (px)<input
						use:inheritedNumber={'size'}
						type="number"
						min="0.01"
						step="any"
						value={draft.size ?? ''}
						placeholder={String(defaults.size ?? 'Inherit')}
						oninput={(event) => numberInput('size', event)}
					/></label
				>
				<label
					>Weight<input
						use:inheritedNumber={'weight'}
						type="number"
						min="1"
						max="1000"
						step="1"
						value={draft.weight ?? ''}
						placeholder={String(defaults.weight ?? 'Inherit')}
						oninput={(event) => numberInput('weight', event)}
					/></label
				>
				<label
					>Style<select
						aria-label="Style"
						value={draft.style ?? ''}
						onchange={(event) =>
							void update('style', (event.currentTarget.value || undefined) as Font['style'])}
						><option value="">Inherit{defaults.style ? ` (${defaults.style})` : ''}</option><option
							value="normal">Normal</option
						><option value="italic">Italic</option><option value="oblique">Oblique</option></select
					></label
				>
				<label
					>Line height<input
						use:inheritedNumber={'lineHeight'}
						type="number"
						min="0.1"
						step="0.1"
						value={draft.lineHeight ?? ''}
						placeholder={String(defaults.lineHeight ?? 'Inherit')}
						oninput={(event) => numberInput('lineHeight', event)}
					/></label
				>
				<label
					>Letter spacing (px)<input
						use:inheritedNumber={'letterSpacing'}
						type="number"
						step="any"
						value={draft.letterSpacing ?? ''}
						placeholder={String(defaults.letterSpacing ?? 'Inherit')}
						oninput={(event) => numberInput('letterSpacing', event)}
					/></label
				>
			</div>
			<p class="hint">
				Changes apply immediately. Empty fields inherit defaults.
				{scope === 'album'
					? 'Album defaults are shared across languages. Language, page, and bubble overrides take precedence.'
					: 'Bubble overrides take precedence over page settings.'}
			</p>
			<button
				type="button"
				class="reset"
				onclick={() => {
					draft = {};
					void update('family', undefined);
				}}>Reset to inherited font</button
			>
		</fieldset>
		{#if scope !== 'bubble'}
			<details class="advanced">
				<summary>Advanced font resources</summary>
				{#key faceKey}<FontFaces
						{faces}
						disabled={disabled || busy}
						onchange={onfaceschange}
					/>{/key}
			</details>
		{/if}
		{#if error}<p role="alert">{error}</p>{/if}
	</div>
</div>

<style>
	.font-settings {
		position: fixed;
		z-index: 7000;
		width: min(336px, 100vw);
		overflow: auto;
		background: white;
		color: #161616;
		border: 1px solid #c6c6c6;
		box-shadow: 0 4px 18px #0003;
		font-size: 0.875rem;
	}
	header {
		display: flex;
		position: sticky;
		top: 0;
		z-index: 1;
		background: #f4f4f4;
		border-bottom: 1px solid #c6c6c6;
	}
	button {
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.drag-handle {
		flex: 1;
		padding: 0.875rem 1rem;
		text-align: left;
		font-weight: 600;
		cursor: move;
		touch-action: none;
	}
	.close {
		padding: 0.5rem 1rem;
		font-size: 1.5rem;
	}
	.form {
		padding: 1rem;
	}
	label {
		display: block;
		margin-bottom: 0.375rem;
	}
	input,
	select {
		width: 100%;
		box-sizing: border-box;
		background: #f4f4f4;
		border: 0;
		border-bottom: 1px solid #8d8d8d;
		padding: 0.5rem;
		color: inherit;
		font: inherit;
		min-width: 0;
	}
	fieldset {
		border: 0;
		margin: 1rem 0 0;
		padding: 0;
		min-width: 0;
	}
	fieldset:disabled {
		opacity: 0.5;
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.hint {
		margin: 0.5rem 0 1rem;
		color: #525252;
		font-size: 0.75rem;
		line-height: 1.4;
	}
	.reset {
		padding: 0.5rem 0;
		color: #0f62fe;
	}
	button:hover {
		background: #e8e8e8;
	}
	:is(button, input, select):focus-visible {
		outline: 2px solid #0f62fe;
		outline-offset: -2px;
	}
	[role='alert'] {
		color: #da1e28;
		margin-top: 0.75rem;
	}
	.advanced {
		border-top: 1px solid #e0e0e0;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
	}
	.advanced summary {
		color: #525252;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.advanced summary:focus-visible {
		outline: 2px solid #0f62fe;
	}
</style>
