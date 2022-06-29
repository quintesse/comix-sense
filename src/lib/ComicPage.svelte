<script lang="ts">
    import Resource from "./Resource.svelte";
    import type { Comic } from "./types/Comic";

    export let comic: Comic|null = null;
    
    let svg: SVGGraphicsElement;

    function resizeSvg() {
        var bb = svg.getBBox();
        var w = bb.width;
        var h = bb.height;
        svg.setAttribute('width', w + 'px');
        svg.setAttribute('height', h + 'px');
    }
</script>

{#if comic}
    {#await comic.getImageUrl()}
        Loading...
    {:then imgurl}
        <svg bind:this={svg}>
            <defs>
                <filter id="blurry" x="0%" y="0%" height="100%" width="100%">
                    <feGaussianBlur stdDeviation="5" in="SourceGraphic"></feGaussianBlur>
                </filter>
                <clipPath id="svgclip">
                </clipPath>
            </defs>
            <image x="0%" y="0%" id="img" href={imgurl} on:load={resizeSvg}></image>
            <image x="0%" y="0%" id="imgblurred" href={imgurl} filter="url(#blurry)"></image>
            <g id="svgcontent"></g>
        </svg>
        <!-- this tracks the imgurl and revokes it when it's no longer needed -->
        <Resource url={imgurl} />
    {/await}
{:else}
    <slot />
{/if}

<style>
    #imgblurred {
        clip-path: url(#svgclip)
    }    
</style>
