<script lang="ts">
    import type { BblShape } from "./types/Comic";
    import { draggable } from "./types/Draggable";

    const dragHandleStyle = "cursor: nw-resize; opacity: 0.2; user-select: none;";

    export let shape: BblShape;
    export let index: number;
    $: pos = shape.vs[index];

    function updateShape(e: Event) {
        const ce: CustomEvent = e as CustomEvent;
        pos.x = ce.detail.x;
        pos.y = ce.detail.y;
        shape = shape;
    }
</script>

<circle cx={pos.x} cy={pos.y} r=6 style={dragHandleStyle} use:draggable on:drag={updateShape} />
