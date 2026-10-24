<script lang="ts">
	import { fontSource, type Face } from './bbl/metadata';
	let {
		faces = [],
		disabled = false,
		onchange
	}: {
		faces: Face[];
		disabled?: boolean;
		onchange: (faces: Face[]) => Promise<void>;
	} = $props();
	let editing = $state<number | undefined>();
	let family = $state('');
	let src = $state('');
	let style = $state<Face['style']>('normal');
	let weight = $state<number | undefined>(400);
	let pending = $state(false);
	let error = $state('');
	const id = $props.id();
	function reset() {
		editing = undefined;
		family = '';
		src = '';
		style = 'normal';
		weight = 400;
		error = '';
	}
	function edit(index: number) {
		const face = faces[index];
		editing = index;
		family = face.family;
		src = face.src;
		style = face.style;
		weight = face.weight;
		error = '';
	}
	async function apply(next: Face[]) {
		pending = true;
		error = '';
		try {
			await onchange($state.snapshot(next));
			reset();
		} catch (reason) {
			error = 'Could not update font resources: ' + String(reason);
		} finally {
			pending = false;
		}
	}
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const source = fontSource(src.trim());
		if (!source) {
			error = 'Use an album-relative path or an HTTPS URL ending in .woff2, .woff, .ttf, or .otf.';
			return;
		}
		if (!family.trim() || !Number.isInteger(weight) || weight! < 1 || weight! > 1000) return;
		const face: Face = { family: family.trim(), src: source, style, weight: weight! };
		if (
			faces.some(
				(other, i) =>
					i !== editing &&
					other.family.toLowerCase() === face.family.toLowerCase() &&
					other.style === style &&
					other.weight === weight
			)
		) {
			error = 'A face with this family, style, and weight already exists. Edit that entry instead.';
			return;
		}
		const next = [...faces];
		if (editing === undefined) next.push(face);
		else next[editing] = face;
		await apply(next);
	}
</script>

<p class="hint">
	Register font files for this scope, then select their family in Font families above. Paths are
	relative to the album; HTTPS font URLs are also supported. Inherited definitions remain available.
</p>
<fieldset disabled={disabled || pending}>
	{#if faces.length}
		<ul aria-label="Defined font faces">
			{#each faces as face, index}
				<li>
					<div>
						<strong>{face.family}</strong><span>{face.style} · {face.weight}</span><small
							title={face.src}>{face.src}</small
						>
					</div>
					<div class="actions">
						<button
							type="button"
							aria-label={`Edit font face ${index + 1}`}
							onclick={() => edit(index)}>Edit</button
						><button
							type="button"
							aria-label={`Remove font face ${index + 1}`}
							onclick={() => void apply(faces.filter((_, i) => i !== index))}>Remove</button
						>
					</div>
				</li>
			{/each}
		</ul>
	{:else}<p class="hint">No font files defined at this scope.</p>{/if}
	<form onsubmit={submit}>
		<p class="form-title">{editing === undefined ? 'Add font face' : 'Edit font face'}</p>
		<label for="{id}-family">Face family</label><input
			id="{id}-family"
			bind:value={family}
			required
			placeholder="e.g. Komika Text"
		/>
		<label for="{id}-source">Font source</label><input
			id="{id}-source"
			bind:value={src}
			required
			placeholder="fonts/komika.woff2"
			aria-describedby="{id}-source-hint"
		/>
		<p class="hint" id="{id}-source-hint">Supported files: WOFF2, WOFF, TTF, OTF.</p>
		<div class="descriptors">
			<div>
				<label for="{id}-style">Face style</label><select id="{id}-style" bind:value={style}
					><option value="normal">Normal</option><option value="italic">Italic</option><option
						value="oblique">Oblique</option
					></select
				>
			</div>
			<div>
				<label for="{id}-weight">Face weight</label><input
					id="{id}-weight"
					type="number"
					min="1"
					max="1000"
					step="1"
					required
					bind:value={weight}
				/>
			</div>
		</div>
		<div class="actions">
			<button class="apply" type="submit"
				>{pending
					? 'Applying…'
					: editing === undefined
						? 'Add font face'
						: 'Update font face'}</button
			>{#if editing !== undefined}<button type="button" onclick={reset}>Cancel edit</button>{/if}
		</div>
	</form>
</fieldset>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
	.hint {
		color: #525252;
		font-size: 0.75rem;
		line-height: 1.4;
		margin: 0.5rem 0 1rem;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	fieldset:disabled {
		opacity: 0.5;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
	}
	li {
		padding: 0.75rem 0;
		border-bottom: 1px solid #e0e0e0;
	}
	li strong,
	li span,
	li small {
		display: block;
		overflow-wrap: anywhere;
	}
	li span,
	li small {
		color: #525252;
		font-size: 0.75rem;
		margin-top: 0.25rem;
	}
	.form-title {
		font-weight: 600;
		margin: 0 0 0.75rem;
	}
	label {
		display: block;
		margin: 0.75rem 0 0.375rem;
	}
	input,
	select {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		font: inherit;
		padding: 0.5rem;
		border: 0;
		border-bottom: 1px solid #8d8d8d;
		background: #f4f4f4;
		color: inherit;
	}
	.descriptors {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}
	button {
		font: inherit;
		color: #0f62fe;
		border: 0;
		padding: 0.375rem 0;
		background: transparent;
		cursor: pointer;
	}
	.apply {
		margin-top: 0.5rem;
	}
	button:disabled {
		cursor: default;
	}
	:is(button, input, select):focus-visible {
		outline: 2px solid #0f62fe;
		outline-offset: -2px;
	}
	.error {
		color: #da1e28;
		margin-top: 0.75rem;
	}
</style>
