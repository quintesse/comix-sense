<script lang="ts">
    import ComicBubble from "./ComicBubble.svelte";
    import Resource from "./Resource.svelte";
    import { bounds, type Bounds, type Bubble, type Comic, type Shape } from "./types/Comic";

    export let comic: Comic;
    
    let svg: SVGGraphicsElement;

    function resizeSvg() {
        var bb = svg.getBBox();
        var w = bb.width;
        var h = bb.height;
        svg.setAttribute('width', w + 'px');
        svg.setAttribute('height', h + 'px');
    }
</script>

{#await comic.getImageUrl() then imgurl}
{#await comic.getBubbles() then bubbles}
    <svg bind:this={svg}>
        <defs>
            <filter id="blurry" x="0%" y="0%" height="100%" width="100%">
                <feGaussianBlur stdDeviation="5" in="SourceGraphic"></feGaussianBlur>
            </filter>
            <clipPath id="svgclip">
                {#each bubbles as bubble}
                    <ComicBubble shape={bubble.shape} />
                {/each}
            </clipPath>
        </defs>
        <image x="0%" y="0%" id="img" href={imgurl} on:load={resizeSvg}></image>
        <image x="0%" y="0%" id="imgblurred" href={imgurl} filter="url(#blurry)"></image>
        <g id="svgcontent">
            {#each bubbles as bubble}
                <ComicBubble {...bubble} />
            {/each}
        </g>
    </svg>
    <!-- this tracks the imgurl and revokes it when it's no longer needed -->
    <Resource url={imgurl} />
{/await}
{/await}

<style>
    #imgblurred {
        clip-path: url(#svgclip)
    }    
</style>
