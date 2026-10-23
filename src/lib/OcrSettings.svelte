<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { Modal, ComboBox } from 'carbon-components-svelte';
	import {
		completionUrl,
		defaultPrompts,
		discoverModels,
		normalizeAiSettings,
		type AiSettings,
		type AiTask
	} from './textCleanup';

	let {
		open = $bindable(false),
		apiKey = $bindable(''),
		externallyConfigured = false,
		onsaved,
		ai = $bindable(normalizeAiSettings(undefined)),
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
	const tasks = ['cleanup', 'translation'] as const;
	const taskLabels = { cleanup: 'Cleanup', translation: 'Translation' };
	let aiDraft = $state<AiSettings>(normalizeAiSettings(undefined));
	let rememberAi = $state(false);
	let savedRememberAi = false;
	let draft = $state('');
	let remember = $state(false);
	let error = $state('');
	let editor = $state<AiTask>();
	let promptDraft = $state('');
	let promptInput: HTMLTextAreaElement | undefined = $state();
	let availableModels = $state<string[]>([]);
	let loadingModels = $state(false);
	let modelOpen = $state<Record<AiTask, boolean>>({ cleanup: false, translation: false });
	let modelSelections = $state<Record<AiTask, string | undefined>>({
		cleanup: undefined,
		translation: undefined
	});
	let modelItems = $derived(availableModels.map((id) => ({ id, text: id })));

	onMount(() => {
		try {
			const stored = localStorage.getItem(aiStorageKey);
			if (stored) ai = normalizeAiSettings(JSON.parse(stored));
			savedRememberAi = !!ai.apiKey;
		} catch {
			/* Session-only configuration remains available. */
		}
		if (externallyConfigured) return;
		try {
			apiKey = localStorage.getItem(storageKey) ?? '';
			remember = !!apiKey;
		} catch {
			/* A session-only key still works without browser storage. */
		}
	});

	$effect(() => {
		if (open)
			untrack(() => {
				draft = apiKey;
				aiDraft = normalizeAiSettings(ai);
				rememberAi = savedRememberAi;
				editor = undefined;
				error = '';
				modelSelections = { cleanup: undefined, translation: undefined };
			});
	});

	$effect(() => {
		const active = open && tab === 'ai';
		const url = aiDraft.url.trim();
		const key = aiDraft.apiKey.trim();
		availableModels = [];
		loadingModels = false;
		modelOpen = { cleanup: false, translation: false };
		modelSelections = { cleanup: undefined, translation: undefined };
		if (!active || !url) return;
		let cancelled = false;
		const controller = new AbortController();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const debounce = setTimeout(async () => {
			loadingModels = true;
			timeout = setTimeout(() => controller.abort(), 10000);
			try {
				const models = await discoverModels({ url, apiKey: key }, controller.signal);
				if (!cancelled) availableModels = models;
			} finally {
				clearTimeout(timeout);
				if (!cancelled) loadingModels = false;
			}
		}, 400);
		return () => {
			cancelled = true;
			clearTimeout(debounce);
			clearTimeout(timeout);
			controller.abort();
		};
	});

	async function editPrompt(task: AiTask) {
		modelOpen = { cleanup: false, translation: false };
		editor = task;
		promptDraft = aiDraft[task].prompt ?? defaultPrompts[task];
		error = '';
		await tick();
		promptInput?.focus();
	}

	async function leaveEditor(apply: boolean) {
		if (!editor) return;
		const task = editor;
		if (apply) {
			if (!promptDraft.trim()) {
				error = 'Enter a prompt or restore the default.';
				return;
			}
			aiDraft[task].prompt = promptDraft === defaultPrompts[task] ? undefined : promptDraft;
		}
		editor = undefined;
		error = '';
		await tick();
		document.getElementById(`edit-${task}-prompt`)?.focus();
	}

	function insertVariable(variable: string) {
		if (!promptInput) return;
		const start = promptInput.selectionStart;
		promptDraft =
			promptDraft.slice(0, start) + variable + promptDraft.slice(promptInput.selectionEnd);
		void tick().then(() => {
			promptInput?.focus();
			promptInput?.setSelectionRange(start + variable.length, start + variable.length);
		});
	}

	function modelKeydown(event: KeyboardEvent) {
		if (!open || editor || event.key !== 'Escape') return;
		const task = tasks.find((task) => (event.target as HTMLElement)?.id === `ai-${task}-model`);
		if (!task) return;
		// Carbon clears custom input on Escape; closing suggestions must preserve the model ID.
		event.preventDefault();
		event.stopPropagation();
		if (modelOpen[task]) modelOpen[task] = false;
		else open = false;
	}

	function cancel() {
		if (editor) void leaveEditor(false);
		else open = false;
	}

	function save() {
		if (editor) {
			void leaveEditor(true);
			return;
		}
		if (tab === 'ai') {
			try {
				completionUrl(aiDraft.url);
				const next = normalizeAiSettings(aiDraft);
				next.url = next.url.trim();
				next.apiKey = next.apiKey.trim();
				for (const task of tasks) next[task].model = next[task].model.trim();
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
				savedRememberAi = rememberAi;
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
		rememberAi = savedRememberAi = false;
		try {
			const stored = localStorage.getItem(aiStorageKey);
			if (stored)
				localStorage.setItem(
					aiStorageKey,
					JSON.stringify({ ...normalizeAiSettings(JSON.parse(stored)), apiKey: '' })
				);
			error = '';
		} catch {
			error = 'Could not remove the saved key from browser storage.';
		}
	}

	function forget() {
		apiKey = draft = '';
		remember = false;
		try {
			localStorage.removeItem(storageKey);
			error = '';
		} catch {
			error = 'Could not remove the saved key from browser storage.';
		}
	}
</script>

<svelte:window on:keydown|capture={modelKeydown} />

<Modal
	bind:open
	modalHeading={editor
		? `${taskLabels[editor]} prompt`
		: tab === 'ai'
			? 'AI text tools'
			: 'Google Vision OCR'}
	passiveModal={tab === 'ocr' && externallyConfigured}
	primaryButtonText={editor ? 'Use prompt' : tab === 'ai' ? 'Save settings' : 'Use key'}
	secondaryButtonText="Cancel"
	primaryButtonDisabled={editor
		? !promptDraft.trim()
		: tab === 'ai'
			? !aiDraft.url.trim()
			: !draft.trim()}
	size={editor ? 'lg' : tab === 'ai' ? undefined : 'sm'}
	shouldSubmitOnEnter={!editor && tab === 'ocr'}
	on:submit={save}
	on:click:button--secondary={cancel}
>
	{#if editor}
		<button type="button" class="back-button" onclick={() => void leaveEditor(false)}
			>← AI text tools</button
		>
		<label for="ai-prompt">Instructions</label>
		<textarea
			id="ai-prompt"
			bind:this={promptInput}
			bind:value={promptDraft}
			rows="14"
			spellcheck="false"></textarea>
		<div class="variables">
			<span>Insert variable</span>
			<button type="button" onclick={() => insertVariable('{sourceLanguage}')}
				>{'{sourceLanguage}'}</button
			>
			<button type="button" onclick={() => insertVariable('{targetLanguage}')}
				>{'{targetLanguage}'}</button
			>
		</div>
		<p>Variables are replaced with the page's source and selected target language codes.</p>
		<button
			type="button"
			onclick={() => {
				promptDraft = defaultPrompts[editor!];
				error = '';
			}}>Restore default prompt</button
		>
		<p>Use prompt keeps this change in the settings draft. Save settings applies it.</p>
	{:else}
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
				<h3>Provider</h3>
				<label for="ai-url">Provider URL</label>
				<input
					id="ai-url"
					type="url"
					bind:value={aiDraft.url}
					placeholder="https://api.openai.com/v1"
				/>
				<p>API base URL (including /v1 if required) or full /chat/completions URL.</p>
				<label for="ai-key">AI API key</label>
				<input id="ai-key" type="password" autocomplete="off" bind:value={aiDraft.apiKey} />
				<p>Optional for providers without authentication.</p>
				<label class="remember"
					><input type="checkbox" bind:checked={rememberAi} /> Remember on this browser</label
				>
				<p>Remembered keys are stored in this site's browser storage without encryption.</p>
				<button type="button" onclick={forgetAi}>Forget key</button>
				{#each tasks as task}
					<section class="ai-task" aria-label={taskLabels[task]}>
						<h3>{taskLabels[task]}</h3>
						<ComboBox
							id={`ai-${task}-model`}
							labelText={`${taskLabels[task]} model`}
							placeholder="Choose or enter a model ID"
							items={modelItems}
							shouldFilterItem={(item, value) =>
								String(item.id).toLowerCase().includes(value.toLowerCase())}
							bind:value={aiDraft[task].model}
							bind:selectedId={modelSelections[task]}
							bind:open={modelOpen[task]}
							allowCustomValue
							on:focus={() => (modelOpen[task === 'cleanup' ? 'translation' : 'cleanup'] = false)}
							on:input={() => (modelSelections[task] = undefined)}
						/>
						<div class="prompt-row">
							<span
								>Prompt <span class="prompt-state"
									>{aiDraft[task].prompt === undefined ? 'Default' : 'Customized'}</span
								></span
							>
							<button
								id={`edit-${task}-prompt`}
								type="button"
								aria-label={`Edit ${task} prompt`}
								onclick={() => void editPrompt(task)}>Edit prompt</button
							>
						</div>
					</section>
				{/each}
				<p role="status">
					{loadingModels
						? 'Loading available models…'
						: availableModels.length
							? `${availableModels.length} models available. You can also enter your own model ID.`
							: 'No model suggestions available. Enter any model ID.'}
				</p>
				<p>
					Set a model for each tool you want to use. Models must support strict JSON Schema output.
					The provider must allow browser requests (CORS).
				</p>
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
	h3 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 1rem;
	}
	p {
		margin: 1rem 0;
	}
	input:not([type='checkbox']),
	textarea {
		display: block;
		width: 100%;
		margin: 0.5rem 0 1rem;
		padding: 0.75rem;
	}
	textarea {
		resize: vertical;
		font-family: monospace;
	}
	.remember,
	.variables,
	.prompt-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 1rem 0;
	}
	.prompt-row {
		justify-content: space-between;
	}
	.prompt-state {
		margin-left: 0.5rem;
		color: #525252;
	}
	.ai-task {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid #e0e0e0;
	}
	.back-button {
		display: block;
		margin-bottom: 1rem;
	}
	#ai-panel p {
		font-size: 0.875rem;
		margin: 0.5rem 0;
	}
	#ai-panel input:not([type='checkbox']) {
		margin: 0.25rem 0;
		padding: 0.5rem;
	}
	#ai-panel .remember {
		margin: 0.75rem 0 0.25rem;
	}
	#ai-panel h3 {
		margin-bottom: 0.5rem;
	}
	.ai-task {
		margin-top: 1rem;
		padding-top: 0.75rem;
	}
	.prompt-row {
		margin: 0.5rem 0;
	}
</style>
