<script lang="ts">
	import { onMount } from 'svelte';
	import { Modal } from 'carbon-components-svelte';

	let {
		open = $bindable(false),
		apiKey = $bindable(''),
		externallyConfigured = false,
		onsaved
	}: {
		open?: boolean;
		apiKey?: string;
		externallyConfigured?: boolean;
		onsaved: () => void;
	} = $props();
	const storageKey = 'comix-sense.google-vision-api-key';
	let draft = $state('');
	let remember = $state(false);
	let error = $state('');
	onMount(() => {
		if (externallyConfigured) return;
		try {
			apiKey = localStorage.getItem(storageKey) ?? '';
			remember = !!apiKey;
		} catch {
			// A session-only key still works when browser storage is unavailable.
		}
	});
	$effect(() => {
		if (open) {
			draft = apiKey;
			error = '';
		}
	});
	function save() {
		if (!draft.trim()) return;
		try {
			if (remember) localStorage.setItem(storageKey, draft.trim());
			else localStorage.removeItem(storageKey);
		} catch {
			error = 'Could not update browser storage. Uncheck Remember to use the key for this session.';
			if (remember) return;
		}
		apiKey = draft.trim();
		open = false;
		onsaved();
	}
	function forget() {
		apiKey = '';
		draft = '';
		remember = false;
		try {
			localStorage.removeItem(storageKey);
			error = '';
		} catch {
			error = 'Could not remove the saved key from browser storage.';
		}
	}
</script>

<Modal
	bind:open
	modalHeading="Google Vision OCR"
	passiveModal={externallyConfigured}
	primaryButtonText="Use key"
	secondaryButtonText="Cancel"
	primaryButtonDisabled={!draft.trim()}
	size="sm"
	on:submit={save}
	on:click:button--secondary={() => (open = false)}
>
	<p>Full-page scans send the selected page image to Google Cloud Vision.</p>
	{#if externallyConfigured}
		<p>Google Vision API key</p>
		<p>Using the externally set <code>GOOGLE_VISION_KEY</code>.</p>
	{:else}
		<label for="vision-api-key">Google Vision API key</label>
		<input id="vision-api-key" type="password" autocomplete="off" bind:value={draft} />
		<label class="remember"
			><input type="checkbox" bind:checked={remember} /> Remember on this browser</label
		>
		<p>Remembered keys are stored in this site's browser storage without encryption.</p>
		<button type="button" onclick={forget}>Forget key</button>
		{#if error}<p role="alert">{error}</p>{/if}
	{/if}
</Modal>

<style>
	p {
		margin-bottom: 1rem;
	}
	input[type='password'] {
		display: block;
		width: 100%;
		margin: 0.5rem 0 1rem;
		padding: 0.75rem;
	}
	.remember {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
</style>
