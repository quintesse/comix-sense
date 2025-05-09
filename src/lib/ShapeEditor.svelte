<script lang="ts">
    import { run } from 'svelte/legacy';
    import { onDestroy } from 'svelte';
    import { BblShapeType, bounds, boundsv, distance, points, vertex, type BblShape, type Vertex } from './types/Comic';
	import { createEventDispatcher } from 'svelte';

    interface Props {
        shape?: BblShapeType;
        svg: SVGGraphicsElement;
    }

    let { shape = BblShapeType.box, svg }: Props = $props();;

    const dispatch = createEventDispatcher();

    let lostFocus: boolean = $state(false);
    let isFirstClick: boolean = $state(true);
    let vs: Vertex[] = $state([vertex(0, 0), vertex(0, 0)]);

    function handleClick(evt: MouseEvent) {
        if (isFirstClick) {
            if (lostFocus) {
                lostFocus = false;
            } else if (evt.target?.tagName.toLowerCase() === "image") {
                svg.addEventListener("mousemove", handleMove);
                document.addEventListener("keydown", handleKeyDown);
                vs = [];
                vs[0] = vertex(evt.offsetX, evt.offsetY);
                vs[1] = vertex(evt.offsetX, evt.offsetY);
                isFirstClick = false;
            }
        } else if (isLastClick(evt)) {
            svg.removeEventListener("mousemove", handleMove);
            document.removeEventListener("keydown", handleKeyDown);
            vs[vs.length - 1] = vertex(evt.offsetX, evt.offsetY);
            isFirstClick = true;
            dispatch('shape', bblShape());
        } else {
            vs[vs.length - 1] = vertex(evt.offsetX, evt.offsetY);
            vs[vs.length] = vertex(evt.offsetX, evt.offsetY);
        }
    }

    function handleMove(evt: MouseEvent) {
        vs[vs.length - 1] = vertex(evt.offsetX, evt.offsetY);
    }

    function handleKeyDown(evt: KeyboardEvent) {
        if (evt.key === "Escape") {
            isFirstClick = true;
        } else if (evt.key === "Backspace") {
            if (vs.length > 2) {
                vs[vs.length - 2] = vs.pop() as Vertex;
            } else {
                isFirstClick = true;
            }
        }
    }

    function isLastClick(evt: MouseEvent): boolean {
        if (shape === BblShapeType.box) {
            return vs.length == 2;
        } else {
            const vlast = vertex(evt.offsetX, evt.offsetY);
            return vs.length > 2 && distance(vs[0], vlast) < 10;
        }
    }

    function isValidShape(vs: Vertex[]): boolean {
        if (shape === BblShapeType.box) {
            if (vs.length == 2) {
                const bb = bounds(vs);
                return bb.w >= 10 && bb.h >= 10;
            }
        } else {
            return vs.length > 2 && distance(vs[0], vs[vs.length - 1]) < 10;
        }
        return false;
    }

    function shapeVertices(vs: Vertex[]) {
        if (shape === BblShapeType.box) {
            return [vertex(vs[0].x, vs[0].y), vertex(vs[0].x, vs[1].y), vertex(vs[1].x, vs[1].y), vertex(vs[1].x, vs[0].y)];
        } else {
            return vs;
        }
    }

    function bblShape(): BblShape {
        let result = {
            type: shape,
            vs: vs
        };
        if (shape === BblShapeType.box) {
            result.vs = boundsv(vs);
        }
        return result;
    }

	onDestroy(() => {
		if (svg) {
            svg.removeEventListener("click", handleClick);
            svg.removeEventListener("mousemove", handleMove);
            document.removeEventListener("keydown", handleKeyDown);
        };
	});

    run(() => {
        if (svg) {
            svg.addEventListener("click", handleClick);
            svg.addEventListener("blur", () => lostFocus = true);
        }
    });

    let shapevs = $derived(shapeVertices(vs));
    let pts = $derived(points(shapevs));
    let valid = $derived(isValidShape(shapevs));
</script>

{#if !isFirstClick}
    <rect x="0%" y="0%" width="100%" height="100%" />
    <polygon points={pts} class:valid={valid} />
{/if}

<style>
    rect {
        opacity: 0;
    }

    polygon {
        fill: white;
        opacity: 0.8;
        stroke: black;
        stroke-width:3;
    }

    polygon.valid {
        stroke: green;
    }
</style>