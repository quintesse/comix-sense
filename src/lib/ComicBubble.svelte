<script lang="ts">
    import { bounds, type BblShape, type Vertex } from "./types/Comic";
    import type { StrStrMap } from "./types/funcs";

    const defaultStyle = "fill:white;opacity:0.8;";

    export let text: string | undefined = undefined;
    export let lang: string | undefined = undefined;
    export let style: StrStrMap = {};
    export let shape: BblShape;
    export let shapeonly: boolean = false;
    $: shapeStyle = defaultStyle + styleString(style);
    $: bb = bounds(shape.vs);

    function styleString(style: StrStrMap): string {
        return Object.entries(style).map(e => e[0] + ":" + e[1] + ";").join("");
    }

    function points(vs: Vertex[]): string {
        return vs.map(v => v.x + "," + v.y).join(" ");
    }
</script>

{#if shape.type === "box"}
    <rect x={bb.x1} y={bb.y1} width={bb.w} height={bb.h} style={shapeStyle}>
        {#if text && !shapeonly}
            <title>{text}</title>
        {/if}
    </rect>
{:else if shape.type === "poly"}
    <polygon points={points(shape.vs)} style={shapeStyle}>
        {#if text && !shapeonly}
            <title>{text}</title>
        {/if}
    </polygon>
{/if}

{#if text && !shapeonly}
    <foreignObject x={bb.x1} y={bb.y1} width={bb.w} height={bb.h} style="overflow: visible;">
        <div class="bubbletext">{text}</div>
    </foreignObject>
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