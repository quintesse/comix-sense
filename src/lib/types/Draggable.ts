
export type DragDetail = {
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
    originalEvent: MouseEvent;
};

export function draggable(node: Element) {
    let dragging = false;
    let startX = 0, startY = 0;

    const onMouseDown = (event: Event) => {
        dragging = true;
        const mevt: MouseEvent = event as MouseEvent;
        startX = mevt.offsetX;
        startY = mevt.offsetY;
        const e = new CustomEvent<DragDetail>("dragstart", {
            detail: {
                x: mevt.offsetX,
                y: mevt.offsetY,
                deltaX: 0,
                deltaY: 0,
                originalEvent: mevt
            }
        });
        //console.log("dragstart", e);
        document.addEventListener("mouseup", onMouseUp, true);
        document.addEventListener("mousemove", onMouseMove, true);
        node.dispatchEvent(e);
	};

    const onMouseMove = (event: MouseEvent) => {
        if (dragging) {
            const e = new CustomEvent<DragDetail>("drag", {
                detail: {
                    x: event.offsetX,
                    y: event.offsetY,
                    deltaX: event.offsetX - startX,
                    deltaY: event.offsetY - startY,
                    originalEvent: event
                }
            });
            //console.log("drag", e);
            node.dispatchEvent(e);
        }
	};

    const onMouseUp = (event: MouseEvent) => {
        dragging = true;
        const e = new CustomEvent<DragDetail>("dragend", {
            detail: {
                x: event.offsetX,
                y: event.offsetY,
                deltaX: event.offsetX - startX,
                deltaY: event.offsetY - startY,
                originalEvent: event
            }
        });
        //console.log("dragend", e);
        node.dispatchEvent(e);
        document.removeEventListener("mousemove", onMouseMove, true);
        document.removeEventListener("mouseup", onMouseUp, true);
    };

    node.addEventListener("mousedown", onMouseDown, true)

	return {
		destroy() {
			node.removeEventListener("mousedown", onMouseDown, true);
			document.removeEventListener("mousemove", onMouseMove, true);
			document.removeEventListener("mouseup", onMouseUp, true);
		}
	};
}
