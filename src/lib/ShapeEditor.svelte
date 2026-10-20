<script lang="ts">
	import {
		BblShapeType,
		bounds,
		boundsv,
		distance,
		points,
		vertex,
		type BblShape,
		type Vertex
	} from './types/Comic';
	import { svgPoint } from './types/funcs';

	let {
		shape = BblShapeType.box,
		svg,
		onshape
	}: {
		shape?: BblShapeType;
		svg: SVGSVGElement;
		onshape?: (shape: BblShape) => void;
	} = $props();

	let vs = $state<Vertex[]>([]);
	let drawing = $derived(vs.length > 0);
	let preview = $derived(
		shape === BblShapeType.box && drawing
			? [vs[0], vertex(vs[0].x, vs[1].y), vs[1], vertex(vs[1].x, vs[0].y)]
			: vs
	);
	let valid = $derived(
		drawing &&
			(shape === BblShapeType.box
				? bounds(vs).w >= 10 && bounds(vs).h >= 10
				: vs.length >= 4 && distance(vs[0], vs[vs.length - 1]) < 10)
	);

	function handleClick(event: MouseEvent) {
		if (event.button !== 0) return;
		const point = svgPoint(svg, event);
		if (!drawing) {
			if (!(event.target instanceof SVGImageElement)) return;
			vs = [point, point];
		} else {
			vs[vs.length - 1] = point;
			if (shape === BblShapeType.box || (vs.length >= 4 && distance(vs[0], point) < 10)) {
				if (valid) {
					const vertices = shape === BblShapeType.box ? boundsv(vs) : vs.slice(0, -1);
					onshape?.({ type: shape, vs: vertices.map((v) => vertex(v.x, v.y)) });
				}
				vs = [];
			} else {
				vs.push(point);
			}
		}
	}

	$effect(() => {
		// Reset an unfinished shape when changing tool or page.
		shape;
		const target = svg;
		vs = [];
		target.addEventListener('click', handleClick);
		return () => target.removeEventListener('click', handleClick);
	});

	$effect(() => {
		if (!drawing) return;
		function move(event: MouseEvent) {
			vs[vs.length - 1] = svgPoint(svg, event);
		}
		function keydown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				vs = [];
			} else if (event.key === 'Backspace') {
				event.preventDefault();
				if (vs.length > 2) vs.splice(vs.length - 2, 1);
				else vs = [];
			}
		}
		svg.addEventListener('mousemove', move);
		document.addEventListener('keydown', keydown);
		return () => {
			svg.removeEventListener('mousemove', move);
			document.removeEventListener('keydown', keydown);
		};
	});
</script>

{#if drawing}
	<rect x="0" y="0" width="100%" height="100%" class="drawing-target" />
	<polygon points={points(preview)} class:valid />
{/if}

<style>
	.drawing-target {
		opacity: 0;
	}
	polygon {
		fill: white;
		opacity: 0.8;
		stroke: black;
		stroke-width: 3;
		pointer-events: none;
	}
	polygon.valid {
		stroke: green;
	}
</style>
