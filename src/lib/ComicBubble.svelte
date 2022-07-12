<script lang="ts">
    import { getContext } from "svelte";
    import DragHandle from "./DragHandle.svelte";
    import { bounds, type BblShape, points, vertex, type Bounds } from "./types/Comic";
    import type { StrStrMap } from "./types/funcs";

    const defaultStyle = "fill:white;opacity:0.8;";

    export let text: string | undefined = undefined;
    export let lang: string | undefined = undefined;
    export let style: StrStrMap = {};
    export let shape: BblShape;
    $: shapeStyle = defaultStyle + styleString(style);
    $: bb = bounds(shape.vs);
    export let editable: boolean = false;
    export let renderMode: string = "normal";

    function styleString(style: StrStrMap): string {
        return Object.entries(style).map(e => e[0] + ":" + e[1] + ";").join("");
    }

    function shapeOnly(): boolean {
        return renderMode === "clippath";
    }
</script>

{#if shape.type === "box"}
    <rect x={bb.x1} y={bb.y1} width={bb.w} height={bb.h} style={shapeStyle}>
        {#if text && !shapeOnly()}
            <title>{text}</title>
        {/if}
    </rect>
{:else if shape.type === "poly"}
    <polygon points={points(shape.vs)} style={shapeStyle}>
        {#if text && !shapeOnly()}
            <title>{text}</title>
        {/if}
    </polygon>
{/if}

{#if text && !shapeOnly()}
    <foreignObject x={bb.x1} y={bb.y1} width={bb.w} height={bb.h} style="overflow: visible;">
        <div class="bubbletext">{text}</div>
    </foreignObject>
{/if}

{#if editable && !shapeOnly()}
    <DragHandle bind:shape index={0} />
    <DragHandle bind:shape index={1} />
{/if}

<style>
    .bubbletext {
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