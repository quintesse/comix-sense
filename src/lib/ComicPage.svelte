<script lang="ts">
    import ShapeEditor from "./ShapeEditor.svelte";
    import { BblShapeType, type BblShape } from "./types/Comic";

    interface Props {
        img: string;
        editable?: boolean;
        selectedShape?: BblShapeType;
        children?: import('svelte').Snippet<[any]>;
    }

    let {
        img,
        editable = false,
        selectedShape = BblShapeType.box,
        children
    }: Props = $props();

    let svg: SVGGraphicsElement = $state();

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
            {@render children?.({ renderMode: "clippath", })}
        </clipPath>
    </defs>
    <image x="0%" y="0%" href={img} onload={resizeSvg}></image>
    <image x="0%" y="0%" href={img} filter="url(#blurry)" style="clip-path: url(#svgclip)"></image>
    <g id="svgcontent">
        {@render children?.({ renderMode: "normal", })}
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
