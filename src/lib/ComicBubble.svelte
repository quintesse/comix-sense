<script lang="ts">
    import DragHandle from "./DragHandle.svelte";
    import { bounds, points, type Bubble, BblShapeType } from "./types/Comic";
    import type { StrStrMap } from "./types/funcs";

    export let bubble: Bubble;
    $: cursor = bubble.shape.type === BblShapeType.box ? "nw-resize" : "move";
    $: shapeStyle = styleString(bubble.style);
    $: bb = bounds(bubble.shape.vs);
    export let editable: boolean = false;
    export let renderMode: string = "normal";

    function styleString(style: StrStrMap|undefined): string {
        return Object.entries(style || {}).map(e => e[0] + ":" + e[1] + ";").join("");
    }

    function shapeOnly(): boolean {
        return renderMode === "clippath";
    }
</script>

{#if bubble.shape.type === BblShapeType.box}
    <rect x={bb.x1} y={bb.y1} width={bb.w} height={bb.h} class="bubble" style={shapeStyle}>
        {#if bubble.text && !shapeOnly()}
            <title>{bubble.text}</title>
        {/if}
    </rect>
{:else if bubble.shape.type === BblShapeType.poly}
    <polygon points={points(bubble.shape.vs)} class="bubble" style={shapeStyle}>
        {#if bubble.text && !shapeOnly()}
            <title>{bubble.text}</title>
        {/if}
    </polygon>
{/if}

{#if !shapeOnly()}
    <foreignObject x={bb.x1} y={bb.y1} width={bb.w} height={bb.h}>
        {#if editable}
            <div contenteditable="true" bind:textContent={bubble.text}></div>
        {:else}
            <div>{bubble.text}</div>
        {/if}
    </foreignObject>
{/if}

{#if editable && !shapeOnly()}
    {#each bubble.shape.vs as v, i}
        <DragHandle bind:shape={bubble.shape} index={i} style={"cursor:" + cursor} />
    {/each}
{/if}

<style>
    .bubble {
        fill: white;
        opacity: 0.8;
    }

    foreignObject {
        overflow: visible;
        user-select: text;
    }

    foreignObject div {
        font-size: 18pt;
        line-height: 100%;
        overflow: hidden;
        width: 100%;
        height: 100%;
        word-wrap: break-word;
        word-break: break-word;
        white-space: normal;
        text-align: center;
    }
</style>