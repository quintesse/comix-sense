<script lang="ts">
    import ShapeEditor from "./ShapeEditor.svelte";
    import { BblShapeType, type BblShape } from "./types/Comic";

    export let img: string;
    export let editable: boolean = false;
	export let selectedShape: BblShapeType = BblShapeType.box;

    let svg: SVGGraphicsElement;

    function resizeSvg() {
        var bb = svg.getBBox();
        var w = bb.width;
        var h = bb.height;
        svg.setAttribute('width', w + 'px');
        svg.setAttribute('height', h + 'px');
    }
</script>

<svg bind:this={svg} tabindex="-1">
    <defs>
        <filter id="blurry" x="0%" y="0%" height="100%" width="100%">
            <feGaussianBlur stdDeviation="5" in="SourceGraphic"></feGaussianBlur>
        </filter>
        <clipPath id="svgclip">
            <slot renderMode="clippath" />
        </clipPath>
    </defs>
    <image x="0%" y="0%" href={img} on:load={resizeSvg}></image>
    <image x="0%" y="0%" href={img} filter="url(#blurry)" style="clip-path: url(#svgclip)"></image>
    <g id="svgcontent">
        <slot renderMode="normal" />
    </g>
    {#if editable}
        <ShapeEditor {svg} shape={selectedShape} on:shape />
    {/if}
</svg>

<style>
    svg {
        user-select: none;
    }
</style>
