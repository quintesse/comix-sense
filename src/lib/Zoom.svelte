<script lang="ts">
    export let level: string|number = "100%";

    let width: number;
	let height: number;
    let wrapper: HTMLElement;
    $: scaleContents(wrapper, width, height, level);

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
</script>

<div bind:clientWidth={width} bind:clientHeight={height} class="fillsize" style="overflow: auto">
    <div bind:this={wrapper} style="display: inline-block">
        <slot/>
    </div>
</div>
