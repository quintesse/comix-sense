<script lang="ts">
	import { onMount } from 'svelte';
	import { completionUrl, type AiSettings } from './textCleanup';
	import { Modal } from 'carbon-components-svelte';

	let {
		open = $bindable(false),
		apiKey = $bindable(''),
		externallyConfigured = false,
		onsaved,
		ai = $bindable({ url: 'https://api.openai.com/v1', model: '', apiKey: '' }),
		tab = $bindable('ocr')
	}: {
		open?: boolean;
		apiKey?: string;
		externallyConfigured?: boolean;
		onsaved: () => void;
		ai?: AiSettings;
		tab?: string;
	} = $props();
	const storageKey = 'comix-sense.google-vision-api-key';
	const aiStorageKey = 'comix-sense.ai-settings';
	let aiDraft = $state<AiSettings>({ url: '', model: '', apiKey: '' });
	let rememberAi = $state(false);
	let draft = $state('');
	let remember = $state(false);
	let error = $state('');
	onMount(() => {
		try {
			const stored = JSON.parse(localStorage.getItem(aiStorageKey) ?? 'null');
			if (stored && typeof stored.url === 'string' && typeof stored.model === 'string') {
				ai = {
					url: stored.url,
					model: stored.model,
					apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : ''
				};
				rememberAi = !!ai.apiKey;
			}
		} catch {
			/* Session-only configuration remains available. */
		}
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
			aiDraft = { ...ai };
			error = '';
		}
	});
	function save() {
		if (tab === 'ai') {
			try {
				completionUrl(aiDraft.url);
				if (!aiDraft.model.trim()) return;
				const next = {
					url: aiDraft.url.trim(),
					model: aiDraft.model.trim(),
					apiKey: aiDraft.apiKey.trim()
				};
				try {
					localStorage.setItem(
						aiStorageKey,
						JSON.stringify({ ...next, apiKey: rememberAi ? next.apiKey : '' })
					);
				} catch {
					if (rememberAi)
						throw new Error('Could not save the key. Uncheck Remember to use it for this session.');
				}
				ai = next;
				open = false;
				onsaved();
			} catch (cause) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
			return;
		}
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
	function forgetAi() {
		ai = { ...ai, apiKey: '' };
		aiDraft.apiKey = '';
		rememberAi = false;
		try {
			const stored = JSON.parse(localStorage.getItem(aiStorageKey) ?? 'null');
			if (stored) localStorage.setItem(aiStorageKey, JSON.stringify({ ...stored, apiKey: '' }));
			error = '';
		} catch {
			error = 'Could not remove the saved key from browser storage.';
		}
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
	modalHeading={tab === 'ai' ? 'AI text tools' : 'Google Vision OCR'}
	passiveModal={tab === 'ocr' && externallyConfigured}
	primaryButtonText={tab === 'ai' ? 'Save settings' : 'Use key'}
	secondaryButtonText="Cancel"
	primaryButtonDisabled={tab === 'ai'
		? !aiDraft.url.trim() || !aiDraft.model.trim()
		: !draft.trim()}
	size="sm"
	on:submit={save}
	on:click:button--secondary={() => (open = false)}
>
	<div role="tablist" aria-label="Settings categories">
		<button
			type="button"
			role="tab"
			id="ocr-tab"
			aria-selected={tab === 'ocr'}
			aria-controls="ocr-panel"
			onclick={() => {
				tab = 'ocr';
				error = '';
			}}>Google Vision OCR</button
		>
		<button
			type="button"
			role="tab"
			id="ai-tab"
			aria-selected={tab === 'ai'}
			aria-controls="ai-panel"
			onclick={() => {
				tab = 'ai';
				error = '';
			}}>AI provider</button
		>
	</div>
	{#if tab === 'ai'}
		<div role="tabpanel" id="ai-panel" aria-labelledby="ai-tab">
			<p>
				Cleanup and translation send bubble text to an OpenAI-compatible Chat Completions provider.
				The provider and model must support strict JSON Schema output. The provider must allow
				requests from this browser (CORS).
			</p>
			<label for="ai-url">Provider URL</label>
			<input
				id="ai-url"
				type="url"
				bind:value={aiDraft.url}
				placeholder="https://api.openai.com/v1"
			/>
			<p>Enter the API base URL, including /v1 if required, or the full /chat/completions URL.</p>
			<label for="ai-model">Model</label>
			<input id="ai-model" bind:value={aiDraft.model} />
			<label for="ai-key">AI API key</label>
			<input id="ai-key" type="password" autocomplete="off" bind:value={aiDraft.apiKey} />
			<p>Leave the key empty for providers that do not require authentication.</p>
			<label class="remember"
				><input type="checkbox" bind:checked={rememberAi} /> Remember on this browser</label
			>
			<p>Remembered keys are stored in this site's browser storage without encryption.</p>
			<button type="button" onclick={forgetAi}>Forget key</button>
		</div>
	{:else}
		<div role="tabpanel" id="ocr-panel" aria-labelledby="ocr-tab">
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
			{/if}
		</div>
	{/if}
	{#if error}<p role="alert">{error}</p>{/if}
</Modal>

<style>
	[role='tablist'] {
		display: flex;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	[role='tab'][aria-selected='true'] {
		font-weight: bold;
		border-bottom: 2px solid #0f62fe;
	}
	p {
		margin-bottom: 1rem;
	}
	input:not([type='checkbox']) {
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
