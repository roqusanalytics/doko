// Monochrome textures drawn in the element's current text colour: halftone dot fields,
// 1-bit dithered photos and the ASCII scramble on section indexes.
const dark = matchMedia('(prefers-color-scheme: dark)');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function fit(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, w, h];
}

// Ordered (Bayer 4×4) dither of `img`, cropped like object-fit: cover. Dark mode lights the bright pixels instead.
// `fade` thins the pixels out towards the top, so the picture dissolves into the page.
function dither(canvas, img, cell = 3, fade = 0, focusY = .5) {
  const [ctx, w, h] = fit(canvas);
  if (!w || !img.naturalWidth) return;
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const off = document.createElement('canvas');
  off.width = cols; off.height = rows;
  const o = off.getContext('2d', { willReadFrequently: true });
  const s = Math.max(cols / img.naturalWidth, rows / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  o.drawImage(img, (cols - dw) / 2, (rows - dh) * focusY, dw, dh);
  const d = o.getImageData(0, 0, cols, rows).data, inv = dark.matches;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getComputedStyle(canvas).color;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = (y * cols + x) * 4;
    const lift = fade * (1 - y / rows) ** 2 * (inv ? -1 : 1);
    const lum = ((.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) / 255 - .5) * 1.3 + .5 + lift; // a little contrast
    const t = (BAYER[(y & 3) * 4 + (x & 3)] + .5) / 16;
    if (inv ? lum > t : lum < t) ctx.fillRect(x * cell, y * cell, cell, cell);
  }
}

// Dot grid whose dot size falls off from a focal point; it breathes slowly and swells under the pointer.
function halftone(canvas) {
  const { step = 11, reach = .5, focus } = canvas.dataset;
  let { fx = .5, fy = .5 } = canvas.dataset;
  const host = canvas.parentElement, max = step * .44;
  let ctx, w, h, color, px = -1e4, py = -1e4, raf = 0, seen = false;
  const size = () => {
    [ctx, w, h] = fit(canvas); color = getComputedStyle(canvas).color;
    const f = focus && host.querySelector(focus); // centre the field on an element; layout offsets ignore transforms
    if (f && w) { fx = (f.offsetLeft + f.offsetWidth / 2 - canvas.offsetLeft) / w; fy = (f.offsetTop + f.offsetHeight / 2 - canvas.offsetTop) / h; }
  };
  const frame = t => {
    raf = 0;
    const cx = w * fx, cy = h * fy, R = Math.max(170, Math.max(w, h) * reach);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let y = step / 2; y < h; y += +step) for (let x = step / 2; x < w; x += +step) {
      const d = Math.hypot(x - cx, y - cy) / R;
      let v = 1 - d + .1 * Math.sin(d * 9 - t * .0011);
      v += Math.max(0, 1 - Math.hypot(x - px, y - py) / 130) * .55;
      const r = max * Math.min(1, Math.max(0, v)) ** 1.6;
      if (r > .3) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    }
    ctx.fill();
    if (!calm && seen) raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  size();
  new ResizeObserver(() => { size(); kick(); }).observe(canvas);
  new IntersectionObserver(es => { seen = es.at(-1).isIntersecting; if (seen) kick(); }).observe(canvas);
  dark.addEventListener('change', () => { size(); kick(); });
  if (!calm && matchMedia('(hover: hover)').matches) {
    host.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); px = e.clientX - r.left; py = e.clientY - r.top; });
    host.addEventListener('pointerleave', () => { px = py = -1e4; });
  }
}

// Photo reel: a dithered copy of the track runs underneath, so photos "develop" as they cross the middle.
const reel = document.querySelector('.reel');
if (reel) {
  const track = reel.querySelector('.reel-track');
  track.innerHTML += track.innerHTML; // wide enough for a seamless loop
  const mono = track.cloneNode(false);
  mono.classList.add('is-dither');
  const paint = [];
  for (const img of track.children) {
    const c = document.createElement('canvas');
    mono.append(c);
    const draw = () => dither(c, img);
    paint.push(draw);
    img.addEventListener('load', draw); // lazy images report complete before they load, so listen as well
    draw();
  }
  const colour = document.createElement('div');
  colour.className = 'reel-color';
  reel.append(mono, colour);
  colour.append(track);
  dark.addEventListener('change', () => paint.forEach(f => f()));
}

// Standalone dithered pictures load their photo only when they come near the viewport.
document.querySelectorAll('canvas[data-dither]').forEach(c => {
  const img = new Image();
  const draw = () => dither(c, img, +c.dataset.cell || 3, +c.dataset.fade || 0, +(c.dataset.focusY ?? .5));
  img.addEventListener('load', () => { draw(); new ResizeObserver(draw).observe(c); dark.addEventListener('change', draw); });
  new IntersectionObserver(([e], io) => { if (e.isIntersecting) { img.src = c.dataset.dither; io.disconnect(); } }, { rootMargin: '600px' }).observe(c);
});

document.querySelectorAll('canvas[data-halftone]').forEach(halftone);

// Section indexes decode from block glyphs the first time they are seen.
if (!calm) {
  const glyphs = '░▒▓█▚/+#';
  const io = new IntersectionObserver(entries => entries.forEach(({ isIntersecting, target: el }) => {
    if (!isIntersecting) return;
    io.unobserve(el);
    const final = el.textContent;
    let f = 0;
    const id = setInterval(() => {
      f++;
      el.textContent = [...final].map((ch, i) => ch === ' ' || i < f / 2 ? ch : glyphs[Math.random() * glyphs.length | 0]).join('');
      if (f / 2 >= final.length) { clearInterval(id); el.textContent = final; }
    }, 45);
  }), { threshold: 1 });
  document.querySelectorAll('[data-scramble]').forEach(el => io.observe(el));
}
