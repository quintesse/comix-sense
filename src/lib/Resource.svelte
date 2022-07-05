<script lang="ts">
    import { onDestroy } from "svelte";

    let oldUrl: string|null = null;
    export let url: string;
    $: {
        //console.log("Resource set url", url);
        if (oldUrl && oldUrl != url) {
            //console.log("Resource revoke old!=new", oldUrl, url);
            URL.revokeObjectURL(oldUrl);
        }
        oldUrl = url;
    }

    onDestroy(() => {
        //console.log("Resource revoke onDestroy", url);
        URL.revokeObjectURL(url);
    });
</script>
