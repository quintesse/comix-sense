<script lang="ts">
    import { run } from 'svelte/legacy';

    import { onDestroy } from "svelte";

    let oldUrl: string|null = $state(null);

    interface Props {
        url: string;
    }

    let { url }: Props = $props();

    run(() => {
        //console.log("Resource set url", url);
        if (oldUrl && oldUrl != url) {
            //console.log("Resource revoke old!=new", oldUrl, url);
            URL.revokeObjectURL(oldUrl);
        }
        oldUrl = url;
    });

    onDestroy(() => {
        //console.log("Resource revoke onDestroy", url);
        URL.revokeObjectURL(url);
    });
</script>
