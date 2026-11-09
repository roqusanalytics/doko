import "./hand-tool.css";

const controls = "a, button, input, textarea, select, [contenteditable='true'], [role='button']";

export function installHandTool(container: HTMLElement): () => void {
  let drag: { pointer: number; x: number; y: number; left: number; top: number } | null = null;
  const interactive = (event: Event) => event.target instanceof Element && !!event.target.closest(controls);
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const release = () => {
    const pointer = drag?.pointer;
    drag = null;
    container.classList.remove("hand-dragging");
    if (pointer !== undefined && container.hasPointerCapture(pointer)) container.releasePointerCapture(pointer);
  };
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || interactive(event)) return;
    stop(event);
    container.ownerDocument.getSelection()?.removeAllRanges();
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: container.scrollLeft, top: container.scrollTop };
    container.setPointerCapture(event.pointerId);
    container.classList.add("hand-dragging");
  };
  const move = (event: PointerEvent) => {
    if (drag?.pointer !== event.pointerId) return;
    stop(event);
    container.scrollLeft = drag.left + drag.x - event.clientX;
    container.scrollTop = drag.top + drag.y - event.clientY;
  };
  const up = (event: PointerEvent) => {
    if (drag?.pointer !== event.pointerId) return;
    stop(event);
    release();
  };
  const click = (event: MouseEvent) => { if (!interactive(event)) stop(event); };
  container.classList.add("hand-tool");
  container.addEventListener("pointerdown", down, true);
  container.addEventListener("pointermove", move, true);
  container.addEventListener("pointerup", up, true);
  container.addEventListener("pointercancel", up, true);
  container.addEventListener("lostpointercapture", release);
  container.addEventListener("click", click, true);
  window.addEventListener("blur", release);
  return () => {
    release();
    container.classList.remove("hand-tool");
    container.removeEventListener("pointerdown", down, true);
    container.removeEventListener("pointermove", move, true);
    container.removeEventListener("pointerup", up, true);
    container.removeEventListener("pointercancel", up, true);
    container.removeEventListener("lostpointercapture", release);
    container.removeEventListener("click", click, true);
    window.removeEventListener("blur", release);
  };
}
