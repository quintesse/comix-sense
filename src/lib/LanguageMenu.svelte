<script lang="ts">
	import ObjectGroupIcon from './icons/ObjectGroupIcon.svelte';
	import ToolbarIcon from './icons/ToolbarIcon.svelte';
	import { flag, languageLabel } from './languageFlags';

	let {
		selected,
		languages,
		unsavedLanguages = new Set<string>(),
		onselect
	}: {
		selected: string;
		languages: string[];
		unsavedLanguages?: ReadonlySet<string>;
		onselect: (language: string) => void;
	} = $props();
	let open = $state(false);
	let container: HTMLLIElement;
	let trigger: HTMLButtonElement;
	function close() {
		open = false;
		trigger.focus();
	}
	function handleKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
		if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
			event.preventDefault();
			open = true;
			queueMicrotask(() => {
				const items = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
				const index = items.indexOf(document.activeElement as HTMLButtonElement);
				const next =
					event.key === 'Home'
						? 0
						: event.key === 'End'
							? items.length - 1
							: index < 0
								? event.key === 'ArrowDown'
									? 0
									: items.length - 1
								: (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
				items[next]?.focus();
			});
		}
	}
</script>

<svelte:window
	onclick={(event) => {
		if (open && event.target instanceof Node && !container.contains(event.target)) open = false;
	}}
/>

<li
	bind:this={container}
	role="none"
	class="language-menu"
	onkeydown={handleKey}
	onfocusout={(event) => {
		if (!container.contains(event.relatedTarget as Node)) open = false;
	}}
>
	<button
		bind:this={trigger}
		class="language-trigger bx--header__menu-item"
		class:unsaved={unsavedLanguages.has(selected)}
		type="button"
		role="menuitem"
		aria-label={selected.toUpperCase()}
		title={languageLabel(selected)}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		{#if selected.toLowerCase() === 'ocr'}<ToolbarIcon
				name="video"
			/>{:else if selected.toLowerCase() === 'mrg'}<ObjectGroupIcon />{:else if flag(selected)}<img
				src={flag(selected)}
				alt=""
				width="24"
				height="18"
			/>{/if}{selected.toUpperCase()}
	</button>
	{#if open}
		<ul role="menu" aria-label={selected.toUpperCase()}>
			{#each ['org', ...languages.filter((language) => language !== 'org')] as language}
				<li role="none">
					<button
						type="button"
						role="menuitemradio"
						aria-checked={selected === language}
						class:unsaved={unsavedLanguages.has(language)}
						onclick={() => {
							onselect(language);
							close();
						}}
					>
						{#if language.toLowerCase() === 'ocr'}<ToolbarIcon
								name="video"
							/>{:else if language.toLowerCase() === 'mrg'}<ObjectGroupIcon
							/>{:else if flag(language)}<img
								src={flag(language)}
								alt=""
								width="24"
								height="18"
							/>{/if}{languageLabel(language)}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</li>

<style>
	button.unsaved {
		font-weight: 700;
	}
	.language-menu {
		position: relative;
	}
	button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: 0;
		font: inherit;
		cursor: pointer;
	}
	.language-trigger {
		height: 3rem;
		color: #161616;
		background: transparent;
	}
	ul {
		position: absolute;
		top: 100%;
		left: 0;
		min-width: 10rem;
		padding: 0.25rem 0;
		background: white;
		box-shadow: 0 4px 8px #0003;
	}
	ul button {
		width: 100%;
		min-height: 2.75rem;
		padding: 0.5rem 1rem;
		background: transparent;
		color: #161616;
		text-align: left;
	}
	button:hover,
	ul button[aria-checked='true'] {
		background: #e0e0e0;
	}
	button:focus-visible {
		outline: 2px solid #0f62fe;
		outline-offset: -2px;
	}
	img {
		object-fit: contain;
	}
</style>
