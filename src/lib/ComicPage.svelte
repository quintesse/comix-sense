<script lang="ts">
    import Resource from "./Resource.svelte";

    export let img: string;
    let shapeonly: boolean;

    let svg: SVGGraphicsElement;

    function resizeSvg() {
        var bb = svg.getBBox();
        var w = bb.width;
        var h = bb.height;
        svg.setAttribute('width', w + 'px');
        svg.setAttribute('height', h + 'px');
    }
</script>

    <svg bind:this={svg}>
        <defs>
            <filter id="blurry" x="0%" y="0%" height="100%" width="100%">
                <feGaussianBlur stdDeviation="5" in="SourceGraphic"></feGaussianBlur>
            </filter>
            <clipPath id="svgclip">
                <slot shapeonly={true} />
            </clipPath>
        </defs>
        <image x="0%" y="0%" id="img" href={img} on:load={resizeSvg}></image>
        <image x="0%" y="0%" id="imgblurred" href={img} filter="url(#blurry)"></image>
        <g id="svgcontent">
            <slot />
        </g>
    </svg>
    <!-- this tracks the imgurl and revokes it when it's no longer needed -->
    <Resource url={img} />

<style>
    #imgblurred {
        clip-path: url(#svgclip)
    }    
</style>
