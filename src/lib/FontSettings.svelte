<script lang="ts">
	import type { Bubble } from './types/Comic';
	import { tick } from 'svelte';
	import type { Font, FontScope, Face } from './bbl/metadata';
	import FontFaces from './FontFaces.svelte';
	import MaskAppearance from './MaskAppearance.svelte';
	import AlbumIcon from './icons/AlbumIcon.svelte';
	import PageIcon from './icons/PageIcon.svelte';
	import ToolbarIcon from './icons/ToolbarIcon.svelte';

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
		onclose,
		bubble,
		part = 'mask',
		onappearance,
		ongeometry
	}: {
		onappearance: (changes: Record<string, string>) => void;
		bubble?: Bubble;
		part?: 'text' | 'mask';
		ongeometry: (action: 'separate' | 'link' | 'text' | 'mask' | 'box' | 'poly') => void;
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
	let familyInput = $state<HTMLInputElement>();
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
	aria-label="Text &amp; Layout Settings"
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
			aria-label="Move Text &amp; Layout Settings"
			title="Drag to move; use arrow keys when focused"
			onpointerdown={start}
			onpointermove={move}
			onpointerup={stop}
			onpointercancel={stop}
			onlostpointercapture={stop}
			onkeydown={moveKey}>Text &amp; Layout Settings</button
		>
		<button
			type="button"
			class="close"
			aria-label="Close Text &amp; Layout Settings"
			title="Close (Esc)"
			onclick={onclose}>×</button
		>
	</header>
	<div class="form">
		<div class="scope-label" id="{id}-scope">Apply to</div>
		<div class="scope-buttons" role="group" aria-labelledby="{id}-scope">
			<button
				type="button"
				aria-label="Current album"
				title="Current album"
				aria-pressed={scope === 'album'}
				disabled={busy}
				onclick={() => (scope = 'album')}
			>
				<AlbumIcon regular />Album
			</button>
			<button
				type="button"
				aria-label="Current page"
				title="Current page"
				aria-pressed={scope === 'page'}
				disabled={busy}
				onclick={() => (scope = 'page')}
			>
				<PageIcon regular />Page
			</button>
			<button
				type="button"
				aria-label="Selected bubble"
				title="Selected bubble"
				aria-pressed={scope === 'bubble'}
				disabled={busy}
				onclick={() => (scope = 'bubble')}
			>
				<ToolbarIcon name="comments" />Bubble
			</button>
		</div>
		{#if disabled}<p class="hint">
				{scope === 'bubble'
					? 'Select a bubble on the page to edit its text and geometry.'
					: 'Select a text overlay to edit its font.'}
			</p>{/if}
		{#if scope === 'bubble' && bubble}
			<fieldset disabled={disabled || busy} aria-label="Bubble geometry">
				<div role="group" aria-label="Edit geometry">
					Edit:
					<button type="button" aria-pressed={part === 'text'} onclick={() => ongeometry('text')}
						>Text area</button
					>
					<button type="button" aria-pressed={part === 'mask'} onclick={() => ongeometry('mask')}
						>Mask</button
					>
				</div>
				{#if part === 'text'}
					{#if bubble.layout === undefined}
						<p>Text follows mask</p>
						<button type="button" onclick={() => ongeometry('separate')}
							>Separate text and mask</button
						>
					{:else}
						<button type="button" onclick={() => ongeometry('link')}
							>Fit text area to mask and link</button
						>
					{/if}
				{:else}
					<button
						type="button"
						onclick={() => ongeometry(bubble.shape.type === 'box' ? 'poly' : 'box')}
						>Convert mask to {bubble.shape.type === 'box' ? 'polygon' : 'box'}</button
					>
				{/if}
			</fieldset>
			{#if part === 'mask'}
				<MaskAppearance {bubble} disabled={disabled || busy} onchange={onappearance} />
			{/if}
		{/if}
		{#if scope !== 'bubble' || part === 'text'}
			<fieldset disabled={disabled || busy} class:text-appearance={scope === 'bubble'}>
				{#if scope === 'bubble'}<legend>Text appearance</legend>{/if}
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
							><option value="">Inherit{defaults.style ? ` (${defaults.style})` : ''}</option
							><option value="normal">Normal</option><option value="italic">Italic</option><option
								value="oblique">Oblique</option
							></select
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
		{/if}
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
	.scope-label {
		margin-bottom: 0.375rem;
	}
	.scope-buttons {
		display: flex;
	}
	.scope-buttons button {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.625rem 0.375rem;
		border: 1px solid #8d8d8d;
		font: inherit;
	}
	.scope-buttons button + button {
		border-left: 0;
	}
	.scope-buttons button :global(svg) {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}
	.scope-buttons button:disabled {
		opacity: 0.5;
		cursor: default;
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
	.text-appearance {
		border-top: 1px solid #e0e0e0;
		padding-top: 0.75rem;
	}
	.text-appearance legend {
		font-weight: 600;
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
	button[aria-pressed='true'] {
		background: #d0e2ff;
		outline: 2px solid #0f62fe;
	}
	[aria-label='Bubble geometry'] button {
		padding: 0.5rem;
		border: 1px solid #8d8d8d;
		margin: 0.25rem 0;
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
