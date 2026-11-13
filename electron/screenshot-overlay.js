(async () => {
  const root = document.getElementById('capture'), selection = document.getElementById('selection');
  const hint = document.getElementById('hint'), shade = document.getElementById('shade'), size = document.getElementById('size');
  const capture = await window.screenshot.load();
  const images = await Promise.all(capture.screens.map(async screen => {
    const image = new Image(); image.src = screen.url; await image.decode();
    Object.assign(image.style, { left: `${screen.bounds.x - capture.bounds.x}px`, top: `${screen.bounds.y - capture.bounds.y}px`, width: `${screen.bounds.width}px`, height: `${screen.bounds.height}px` });
    document.getElementById('screens').append(image);
    return { ...screen, image };
  }));
  if (capture.singleScreen) hint.textContent = 'Selected screen · Drag an area · Enter for everything · Esc to cancel';
  let drag = null, frame = 0, busy = false;
  const point = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
  const rect = (a, b) => ({ x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(b.x-a.x), height: Math.abs(b.y-a.y) });
  const paint = r => { selection.hidden = false; shade.hidden = true; Object.assign(selection.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` }); size.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`; };
  const cancel = () => window.screenshot.finish(null);
  const finish = async r => {
    if (busy || r.width < 1 || r.height < 1) return;
    busy = true; hint.textContent = 'Preparing screenshot…';
    try {
      const scale = Math.max(...images.filter(s => s.bounds.x - capture.bounds.x < r.x + r.width && s.bounds.x + s.bounds.width - capture.bounds.x > r.x && s.bounds.y - capture.bounds.y < r.y + r.height && s.bounds.y + s.bounds.height - capture.bounds.y > r.y).map(s => s.image.naturalWidth / s.bounds.width), 1);
      const canvas = document.createElement('canvas'); canvas.width = Math.round(r.width * scale); canvas.height = Math.round(r.height * scale);
      const context = canvas.getContext('2d');
      context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height);
      for (const screen of images) context.drawImage(screen.image, (screen.bounds.x - capture.bounds.x - r.x) * scale, (screen.bounds.y - capture.bounds.y - r.y) * scale, screen.bounds.width * scale, screen.bounds.height * scale);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Image encoding failed');
      window.screenshot.finish(new Uint8Array(await blob.arrayBuffer()));
    } catch (error) { busy = false; hint.textContent = 'Could not prepare this image. Select a smaller area or press Esc.'; console.error('Screenshot encoding failed', error); }
  };
  root.addEventListener('pointerdown', event => {
    if (busy || event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault(); root.setPointerCapture(event.pointerId); drag = { a: point(event), b: point(event) }; paint(rect(drag.a, drag.b));
  });
  root.addEventListener('pointermove', event => {
    if (!drag) return; drag.b = point(event);
    frame ||= requestAnimationFrame(() => { frame = 0; if (drag) paint(rect(drag.a, drag.b)); });
  });
  root.addEventListener('pointerup', event => {
    if (!drag) return; cancelAnimationFrame(frame); frame = 0;
    const r = rect(drag.a, point(event)); drag = null;
    if (r.width < 1 || r.height < 1) { selection.hidden = true; shade.hidden = false; return; }
    paint(r); void finish(r);
  });
  root.addEventListener('pointercancel', () => { drag = null; cancelAnimationFrame(frame); frame = 0; selection.hidden = true; shade.hidden = false; });
  document.getElementById('cancel').onclick = cancel;
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    if (event.key === 'Enter' && event.target === root) { event.preventDefault(); void finish({ x: 0, y: 0, width: innerWidth, height: innerHeight }); }
    if (event.key === 'Tab') { event.preventDefault(); document.getElementById('cancel').focus(); }
  });
  root.focus();
})().catch(error => { console.error('Screenshot overlay failed', error); window.screenshot.finish(null); });
