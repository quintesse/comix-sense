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

	$effect(() => {
		// Reset an unfinished shape when changing tool or page.
		const tool = shape;
		const target = svg;
		vs = [];
		// Measure intent in screen pixels so the threshold stays consistent at any zoom.
		const minimumDrag = 8;
		let start: { point: Vertex; x: number; y: number } | undefined;
		let ignoreClick = false;

		function cancel() {
			start = undefined;
			vs = [];
		}
		function finish() {
			if (valid) {
				const vertices = tool === BblShapeType.box ? boundsv(vs) : vs.slice(0, -1);
				onshape?.({ type: tool, vs: vertices.map((v) => vertex(v.x, v.y)) });
			}
			cancel();
		}
		function down(event: MouseEvent) {
			ignoreClick = false;
			if (event.button !== 0 || drawing || !(event.target instanceof SVGImageElement)) return;
			event.preventDefault();
			start = { point: svgPoint(target, event), x: event.clientX, y: event.clientY };
		}
		function move(event: MouseEvent) {
			if (start) {
				if (!(event.buttons & 1)) {
					cancel();
					return;
				}
				if (!drawing) {
					if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < minimumDrag) return;
					vs = [start.point, svgPoint(target, event)];
				}
			}
			if (drawing) vs[vs.length - 1] = svgPoint(target, event);
		}
		function up(event: MouseEvent) {
			if (event.button !== 0 || !start) return;
			ignoreClick = true;
			if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < minimumDrag) {
				cancel();
				return;
			}
			start = undefined;
			if (!drawing) return;
			vs[vs.length - 1] = svgPoint(target, event);
			if (tool === BblShapeType.box) finish();
			else vs.push(svgPoint(target, event));
		}
		function click(event: MouseEvent) {
			if (ignoreClick) {
				ignoreClick = false;
				return;
			}
			if (event.button !== 0 || !drawing || start || tool !== BblShapeType.poly) return;
			const point = svgPoint(target, event);
			vs[vs.length - 1] = point;
			if (vs.length >= 4 && distance(vs[0], point) < 10) finish();
			else vs.push(point);
		}
		function keydown(event: KeyboardEvent) {
			if (!drawing && !start) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				cancel();
			} else if (event.key === 'Backspace') {
				event.preventDefault();
				if (!start && vs.length > 2) vs.splice(vs.length - 2, 1);
				else cancel();
			}
		}
		target.addEventListener('mousedown', down);
		target.addEventListener('click', click);
		document.addEventListener('mousemove', move);
		document.addEventListener('mouseup', up);
		document.addEventListener('keydown', keydown);
		window.addEventListener('blur', cancel);
		return () => {
			target.removeEventListener('mousedown', down);
			target.removeEventListener('click', click);
			document.removeEventListener('mousemove', move);
			document.removeEventListener('mouseup', up);
			document.removeEventListener('keydown', keydown);
			window.removeEventListener('blur', cancel);
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
