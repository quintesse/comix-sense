<script lang="ts">
	import { SvelteUIProvider } from '@svelteuidev/core';
	import '../app.css';
</script>

<SvelteUIProvider>
	<slot />
</SvelteUIProvider>
