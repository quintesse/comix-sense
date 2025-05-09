<script lang="ts">
    import { run } from 'svelte/legacy';

    interface Props {
        level?: string|number;
        children?: import('svelte').Snippet;
    }

    let { level = "100%", children }: Props = $props();

    let width: number = $state();
	let height: number = $state();
    let wrapper: HTMLElement = $state();

    function scaleContents(elem: HTMLElement, w: number, h: number, s: string|number) {
        if (elem) {
            elem.style.transform = `scale(1)`;
            elem.style.transformOrigin = '0 0';
            if (typeof s === 'string') {
                if (s === 'fit') {
                    const rect = elem.getBoundingClientRect();
                    const sw = w / rect.width;
                    const sh = h / rect.height;
                    s = Math.min(sw, sh);
                } else if (s === 'width') {
                    const rect = elem.getBoundingClientRect();
                    s = w / rect.width;
                } else if (s.endsWith("%")) {
                    s = parseInt(s.substring(0, s.length-1)) / 100;
                }
            }
            elem.style.transform = `scale(${s})`;
        }
    }
    run(() => {
        scaleContents(wrapper, width, height, level);
    });
</script>

<div bind:clientWidth={width} bind:clientHeight={height} class="fillsize" style="overflow: auto">
    <div bind:this={wrapper} style="display: inline-block">
        {@render children?.()}
    </div>
</div>
