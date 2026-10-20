<script lang="ts">
	interface Props {
		url: string;
	}

	let { url }: Props = $props();

	$effect(() => {
		const resource = url;
		return () => URL.revokeObjectURL(resource);
	});
</script>
