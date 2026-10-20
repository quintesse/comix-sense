/** Browser fullscreen (F11) has no cross-browser change event of its own. */
export function isFullscreen(): boolean {
	if (document.fullscreenElement) return true;
	const native = (window as Window & { fullScreen?: boolean }).fullScreen;
	if (typeof native === 'boolean') return native;

	// Best-effort F11 detection: both the window and its content fill the screen.
	// Normalizing by the window width also accounts for browser page zoom.
	const near = (a: number, b: number) => Math.abs(a - b) <= 2;
	const zoom = window.outerWidth / window.innerWidth;
	return (
		screen.width > 0 &&
		screen.height > 0 &&
		near(window.outerWidth, screen.width) &&
		near(window.outerHeight, screen.height) &&
		near(window.innerHeight * zoom, screen.height)
	);
}
