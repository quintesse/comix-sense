import { svgPoint } from './funcs';

export type DragDetail = {
	x: number;
	y: number;
	deltaX: number;
	deltaY: number;
	originalEvent: MouseEvent;
};

export function draggable(node: SVGGraphicsElement) {
	let dragging = false;
	let start = { x: 0, y: 0 };

	function emit(type: string, event: MouseEvent) {
		const point = node.ownerSVGElement
			? svgPoint(node.ownerSVGElement, event)
			: { x: event.clientX, y: event.clientY };
		node.dispatchEvent(
			new CustomEvent<DragDetail>(type, {
				detail: {
					...point,
					deltaX: point.x - start.x,
					deltaY: point.y - start.y,
					originalEvent: event
				}
			})
		);
	}

	function move(event: MouseEvent) {
		if (dragging) emit('drag', event);
	}

	function stop(event?: MouseEvent) {
		if (dragging && event) emit('dragend', event);
		dragging = false;
		document.removeEventListener('mousemove', move, true);
		document.removeEventListener('mouseup', stop, true);
		window.removeEventListener('blur', cancel);
	}

	function cancel() {
		stop();
	}

	function startDrag(event: MouseEvent) {
		if (event.button !== 0) return;
		event.preventDefault();
		start = node.ownerSVGElement
			? svgPoint(node.ownerSVGElement, event)
			: { x: event.clientX, y: event.clientY };
		dragging = true;
		document.addEventListener('mousemove', move, true);
		document.addEventListener('mouseup', stop, true);
		window.addEventListener('blur', cancel);
		emit('dragstart', event);
	}

	node.addEventListener('mousedown', startDrag);
	return {
		destroy() {
			stop();
			node.removeEventListener('mousedown', startDrag);
		}
	};
}
