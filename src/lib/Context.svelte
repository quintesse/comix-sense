<script lang="ts">
    import { setContext } from "svelte";

    export let key: string;
    export let value: any;

    setContext(key, value);
</script>

<slot />
