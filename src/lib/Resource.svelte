<script lang="ts">
    import { onDestroy } from "svelte";

    let oldUrl: string|null = null;
    export let url: string;
    $: {
        if (oldUrl && oldUrl != url) {
            URL.revokeObjectURL(oldUrl);
        }
        oldUrl = url;
    }

    onDestroy(() => {
        URL.revokeObjectURL(url);
    });
</script>
