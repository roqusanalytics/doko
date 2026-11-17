import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import "./texture.js"; // builds the dithered reel track before the motion below animates it
import { isDark, onTheme } from "./theme.js";

// Hero tabs: the demo moves to the next file every few seconds, in a loop. Hovering the screenshot or switcher,
// or focusing inside it, pauses it (WCAG 2.2.2); leaving resumes. Arrow keys move between files.
const tabs = [...document.querySelectorAll('[role="tab"]')];
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const tablist = document.querySelector('.tabs'), stage = document.querySelector('.stage');
const DELAY = 4800; // keep in sync with the progress line animation in landing.css
let timer = null, hovered = false, focused = false, chosen = false;
function show(i, focus) {
  tabs.forEach((t, j) => {
    const on = i === j;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).classList.toggle('on', on);
  });
  if (focus) tabs[i].focus();
}
const current = () => tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
const pause = () => { clearTimeout(timer); timer = null; tablist.classList.remove('playing'); }; // .playing draws the progress line
const play = () => {
  pause();
  if (calm || hovered || focused || chosen) return;
  void tablist.offsetWidth; // restart the line animation from empty
  tablist.classList.add('playing');
  timer = setTimeout(() => { if (!document.hidden) show((current() + 1) % tabs.length); play(); }, DELAY);
};
tabs.forEach((t, i) => {
  t.addEventListener('click', () => { chosen = true; pause(); show(i); }); // a chosen file stays: the only way to stop the loop on touch screens (WCAG 2.2.2)
  t.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); show(e.key === 'Home' ? 0 : tabs.length - 1, true); }
    if (step) { e.preventDefault(); show((i + step + tabs.length) % tabs.length, true); }
  });
});
for (const el of [document.querySelector('.window'), tablist]) {
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hovered = true; pause(); } });
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hovered = false; play(); } });
}
stage.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) { focused = true; pause(); } }); // keyboard focus only; a mouse click must not freeze the loop
stage.addEventListener('focusout', e => { if (!stage.contains(e.relatedTarget)) { focused = false; play(); } });
play();

// Hero scene: thin curves from every format to the Doko icon. Positions come from layout (offset*), so
// transforms from the animations below never skew them.
const scene = document.querySelector('.converge');
const wiresSvg = scene.querySelector('.wires');
const hubEl = scene.querySelector('.hubx');
const fmts = [...scene.querySelectorAll('.fmt')];
const centre = el => [el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2];
function drawWires() {
  const [hx, hy] = centre(hubEl), r = hubEl.offsetWidth / 2;
  let out = '';
  fmts.forEach((f, i) => {
    if (!f.offsetParent) return; // hidden at this width
    const [tx, ty] = centre(f), cs = getComputedStyle(f), c = (cs.getPropertyValue('--w') || cs.getPropertyValue('--c')).trim(); // --w: wire colour when the tile colour would vanish
    const ex = hx + (tx < hx ? -r : r) * .7;
    const curve = o => `M${tx},${ty} C${tx + (ex - tx) * .55},${ty + o} ${ex - (ex - tx) * .35},${hy + o * .4} ${ex},${hy + o * .2}`;
    for (const o of [-10, -5, 0, 5, 10]) out += `<path class="w" data-i="${i}" stroke="${c}" d="${curve(o)}"/>`;
    out += `<path class="spark" data-i="${i}" stroke="${c}" style="color:${c}" d="${curve(0)}"/>`; // color feeds the CSS glow
  });
  wiresSvg.innerHTML = out;
}
drawWires();
onTheme(() => { drawWires(); window.dispatchEvent(new Event('wires')); });

// Light/dark button: remembers the choice in this browser; without a choice the system setting applies.
const themeBtn = document.querySelector('[data-theme-toggle]');
const syncTheme = () => themeBtn.setAttribute('aria-pressed', isDark());
syncTheme();
onTheme(syncTheme);
themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('doko-theme', next); } catch {} // private mode: the choice lasts for this page only
  dispatchEvent(new Event('themechange'));
});
let sparkCtx;
let sceneWidth = scene.clientWidth;
// Redraw only on real width changes; the observer also fires once on observe().
new ResizeObserver(() => {
  if (scene.clientWidth === sceneWidth) return;
  sceneWidth = scene.clientWidth;
  requestAnimationFrame(() => { drawWires(); window.dispatchEvent(new Event('wires')); });
}).observe(scene);

// Language dropdown: closes on outside click, Escape and after picking an entry.
const langMenu = document.querySelector('[data-lang-menu]');
if (langMenu) {
  document.addEventListener('click', e => { if (!langMenu.contains(e.target)) langMenu.open = false; });
  langMenu.addEventListener('keydown', e => { if (e.key === 'Escape' && langMenu.open) { langMenu.open = false; langMenu.querySelector('summary').focus(); } });
}

// Downloads: link each platform straight to its installer. Asset names change (Folio-* → Doko-*), so match by suffix.
// Without JS or if GitHub's API fails, links keep pointing at the latest release page.
const cards = [...document.querySelectorAll('[data-asset]')];
const touch = navigator.maxTouchPoints > 1; // iPad reports itself as a Mac
const platform = navigator.userAgentData?.platform || navigator.platform || '';
const os = /mac/i.test(platform) ? (touch ? null : 'mac') : /win/i.test(platform) ? 'win' : null;
const get = document.getElementById('get');
const mine = cards.find(a => a.dataset.os === os);
// The localized label comes from data-mac / data-win on the button.
if (mine) get.innerHTML = `<svg aria-hidden="true"><use href="#b-${os === 'mac' ? 'apple' : 'windows'}"/></svg>${get.dataset[os]}`;
fetch('https://api.github.com/repos/roqusanalytics/doko/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
  .then(r => r.ok ? r.json() : Promise.reject(new Error('GitHub API ' + r.status)))
  .then(release => {
    for (const a of cards) {
      const file = release.assets.find(f => new RegExp(a.dataset.asset).test(f.name));
      if (file) a.href = file.browser_download_url;
    }
    if (mine) get.href = mine.href;
    const ver = document.querySelector('[data-version]');
    const date = new Date(release.published_at).toLocaleDateString(document.documentElement.lang, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    ver.textContent = `${ver.dataset.version} ${release.tag_name} · ${date}`;
    ver.hidden = false;
  })
  .catch(err => console.warn('Direct download links unavailable, using the release page.', err));

// Phones and tablets cannot install Doko: say so in the download section and offer to copy the link.
if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (touch && /mac/i.test(platform))) {
  const note = document.querySelector('.phone-note'), copy = note.querySelector('[data-copy]');
  note.hidden = false;
  copy.addEventListener('click', () => (navigator.clipboard?.writeText(location.origin + location.pathname) ?? Promise.reject())
    .then(() => { copy.textContent = copy.dataset.copy; })
    .catch(() => { copy.textContent = location.origin + location.pathname; })); // no clipboard access: show the link to copy by hand
}

// Ask AI "combination lock": provider, file and citation roll into place, then the matching answer appears.
// Each picker is as wide as its current word; neighbours show faintly above and below on wide screens.
const lock = document.querySelector('.ask-lock');
const picks = [...lock.querySelectorAll('.pick')];
const fitPick = (pick, i) => pick.children[i].offsetWidth;
picks.forEach(p => { p.style.width = fitPick(p, 0) + 'px'; });
document.fonts?.ready.then(() => { if (!lock.querySelector('.pick > span[style]')) picks.forEach(p => { p.style.width = fitPick(p, 0) + 'px'; }); }); // re-measure once the web font replaces the fallback

// Spotlight follows the pointer on bento cards (pointer devices only).
if (matchMedia("(hover: hover)").matches) {
  document.querySelectorAll(".cell, .platforms a").forEach(cell => cell.addEventListener("pointermove", e => {
    const r = cell.getBoundingClientRect();
    cell.style.setProperty("--mx", e.clientX - r.left + "px");
    cell.style.setProperty("--my", e.clientY - r.top + "px");
  }));
}

const head = document.querySelector(".masthead");
addEventListener("scroll", () => head.classList.toggle("scrolled", scrollY > 8), { passive: true });

// Motion. Every element's resting CSS is its final state, so with reduced motion the page is complete.
{
  gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);
  const mm = gsap.matchMedia();
  const $ = (s, root = document) => [...root.querySelectorAll(s)];
  const live = el => ({ trigger: el, start: 'top 80%', end: 'bottom top', toggleActions: 'play pause resume pause' });

  function draw(paths) {
    paths.forEach(p => { const len = p.getTotalLength(); gsap.set(p, { strokeDasharray: len, strokeDashoffset: len }); });
    return paths;
  }
  function pulse(svg) {
    $('.dot', svg).forEach((dot, i) => {
      const path = svg.querySelector('#' + dot.dataset.path);
      gsap.timeline({ repeat: -1, delay: i * .22, repeatDelay: .5, scrollTrigger: live(svg) })
        .set(dot, { opacity: 1 })
        .to(dot, { duration: 1.5, ease: 'power1.inOut', motionPath: { path, align: path, alignOrigin: [.5, .5] } })
        .to(dot, { opacity: 0, duration: .2 }, '-=.2');
    });
  }

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    // 1. Hero: one orchestrated entrance.
    gsap.timeline({ defaults: { ease: 'power4.out' } })
      .from('h1 .line > *', { yPercent: 115, filter: 'blur(10px)', duration: 1.4, stagger: .1, ease: 'expo.out' })
      .from('.lede, .actions', { y: 24, opacity: 0, duration: .9, stagger: .08 }, '-=.8');
    // The window sits tilted in 3D and flattens as it scrolls into view.
    gsap.fromTo('.stage', { rotateX: 16, rotateY: -12, rotateZ: 2, scale: .9, transformPerspective: 1800 }, { rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1, ease: 'none', scrollTrigger: { trigger: '.stage', start: 'top bottom', end: 'top 18%', scrub: .8 } });

    // Formats fly out of Doko, wires draw in, then light keeps travelling into the icon.
    const delta = f => { const [tx, ty] = centre(f), [hx, hy] = centre(hubEl); return [hx - tx, hy - ty]; };
    gsap.timeline({ scrollTrigger: { trigger: scene, start: 'top 12%', end: 'bottom top', scrub: .8 } })
      .to(fmts, { x: i => delta(fmts[i])[0] * .85, y: i => delta(fmts[i])[1] * .85, scale: .3, opacity: 0, ease: 'power2.in', invalidateOnRefresh: true }, 0)
      .to(wiresSvg, { opacity: 0, ease: 'none' }, 0)
      .to(hubEl, { scale: .8, ease: 'none' }, 0);
    gsap.from(hubEl, { scale: .4, opacity: 0, duration: 1.2, ease: 'expo.out', delay: .5 });
    gsap.from(fmts.map(f => f.firstElementChild), { x: i => delta(fmts[i])[0], y: i => delta(fmts[i])[1], scale: .2, opacity: 0, duration: 1.5, stagger: .05, ease: 'expo.out', delay: .65 });
    gsap.fromTo(scene.querySelector('.halo'), { scale: 1, opacity: .7 }, { scale: 1.9, opacity: 0, duration: 2.4, ease: 'expo.out', repeat: -1, delay: 2 });
    // Everything below runs in clockwise order around the hub, so the scene reads as one sweep, not noise.
    const angle = i => { const [tx, ty] = centre(fmts[i]), [hx, hy] = centre(hubEl); return (Math.atan2(ty - hy, tx - hx) + Math.PI * 2.5) % (Math.PI * 2); };
    const hubMark = hubEl.querySelector('svg');
    const runWires = (intro) => {
      sparkCtx?.revert();
      sparkCtx = gsap.context(() => {
        const order = i => [...fmts.keys()].filter(j => fmts[j].offsetParent).sort((a, b) => angle(a) - angle(b)).indexOf(i);
        if (intro) wiresSvg.querySelectorAll('.w').forEach(p => {
          const len = p.getTotalLength(), k = order(+p.dataset.i);
          gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.4, ease: 'expo.inOut', delay: 1 + Math.max(0, k) * .06 });
        });
        // One soft comet per format, each leaving its tile a beat after the last; the icon answers every arrival.
        const sparks = [...wiresSvg.querySelectorAll('.spark')].sort((a, b) => order(+a.dataset.i) - order(+b.dataset.i));
        const beat = .5, loop = gsap.timeline({ repeat: -1, delay: intro ? 2.4 : 0, scrollTrigger: live(scene) });
        sparks.forEach((p, k) => {
          const len = p.getTotalLength(), seg = Math.min(70, len * .2), t = k * beat, tile = fmts[+p.dataset.i].firstElementChild;
          loop.set(p, { strokeDasharray: `${seg} ${len + seg}`, strokeDashoffset: seg, opacity: 0 }, t)
            .to(tile, { scale: 1.06, duration: .22, ease: 'power2.out', yoyo: true, repeat: 1 }, t)
            .to(p, { opacity: 1, duration: .3, ease: 'none' }, t)
            .to(p, { strokeDashoffset: -len + seg * .3, duration: 1.7, ease: 'power2.inOut' }, t)
            .to(p, { opacity: 0, duration: .35, ease: 'power1.in' }, t + 1.4)
            .to(hubMark, { scale: 1.04, duration: .2, ease: 'power2.out', yoyo: true, repeat: 1, transformOrigin: '50% 50%' }, t + 1.55);
        });
        loop.to({}, { duration: 1.6 }); // a breath before the next sweep
      });
    };
    runWires(true);
    const rerun = () => runWires(false);
    window.addEventListener('wires', rerun);

    // Kinetic statement: each word sharpens in order as it scrolls through; icons pop in their place.
    const kin = document.querySelector('.kinetic');
    const kinTl = gsap.timeline({ scrollTrigger: { trigger: kin, start: 'top 85%', end: 'bottom 40%', scrub: .6 } });
    [...kin.children].forEach((el, i) => el.classList.contains('ki')
      ? kinTl.fromTo(el, { scale: 0, rotation: -16, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 1.2, ease: 'expo.out' }, i * .45)
      : kinTl.fromTo(el, { opacity: .12, filter: 'blur(8px)', yPercent: 18 }, { opacity: 1, filter: 'blur(0px)', yPercent: 0, duration: 1, ease: 'power2.out' }, i * .45));
    $('.dt').forEach(t => gsap.fromTo(t, { y: 120 * t.dataset.speed }, { y: -120 * t.dataset.speed, ease: 'none', scrollTrigger: { trigger: '.kinetic-sec', start: 'top bottom', end: 'bottom top', scrub: true } }));

    // 2. Section transitions: each heading builds word by word, then the section's content follows in its own way.
    $('.head').forEach(head => {
      const h2 = head.querySelector('h2');
      if (!h2.dataset.split) { // wrap every word once: outer span is the mask, inner span moves
        h2.dataset.split = 1;
        const wrap = node => [...node.childNodes].forEach(n => n.nodeType !== 3 ? wrap(n) : n.replaceWith(...n.textContent.split(/(\s+)/).map(part => {
          if (!part.trim()) return part;
          const w = document.createElement('span');
          w.className = 'w';
          w.append(Object.assign(document.createElement('span'), { textContent: part }));
          return w;
        })));
        wrap(h2);
      }
      gsap.timeline({ scrollTrigger: { trigger: head, start: 'top 82%', once: true } })
        .from(head.querySelector('.idx'), { opacity: 0, scale: .8, duration: .6, ease: 'back.out(2)' })
        .from($('.w > span', h2), { yPercent: 120, rotate: 6, duration: 1.1, stagger: .07, ease: 'expo.out' }, '-=.35')
        .from($('p', head), { y: 24, opacity: 0, filter: 'blur(6px)', duration: 1, ease: 'expo.out' }, '-=.75');
    });
    const enter = (targets, trigger, vars) => gsap.from(targets, { opacity: 0, duration: 1.1, ease: 'expo.out', stagger: .08, scrollTrigger: { trigger, start: 'top 84%', once: true }, ...vars });
    // The headline drifts away as the page moves on; the AI card tips up into place with the scroll.
    gsap.to('.hero h1', { yPercent: -16, opacity: .12, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: () => '+=' + innerHeight * .7, scrub: true } });
    gsap.fromTo('.flow-card', { scale: .9, y: 80, rotateX: 10, opacity: .4, transformPerspective: 1400 }, { scale: 1, y: 0, rotateX: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: '.flow-card', start: 'top bottom', end: 'top 45%', scrub: .8 } });
    enter('.promises li', '.promises', { scale: .7, y: 16, duration: .7, stagger: .07, ease: 'back.out(1.8)' });
    const rows = gsap.timeline({ scrollTrigger: { trigger: '.compare', start: 'top 80%', once: true } });
    $('.compare tr').forEach((row, i) => rows.from(row.children, { opacity: 0, y: 18, duration: .8, stagger: .05, ease: 'expo.out' }, i * .07));
    enter('.details article', '.details', { y: 40, filter: 'blur(6px)', stagger: .09 });
    enter('.faq details', '.faq', { x: -28, stagger: .06 });
    // Download cards start as one fanned deck in the middle of the row and deal out to their places as you scroll.
    // Offsets come from layout (offset*), so the transforms never feed back into the measurements.
    const deck = document.querySelector('.platforms'), cards = $('.platforms li');
    const toCentre = (el, axis) => axis === 'x' ? deck.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2) : deck.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2);
    const fan = [-7, 2, 9];
    gsap.fromTo(cards,
      { x: (i, el) => toCentre(el, 'x') + (i - 1) * 10, y: (i, el) => toCentre(el, 'y') + i * 6, rotation: i => fan[i] ?? 0, scale: .94 },
      { x: 0, y: 0, rotation: 0, scale: 1, ease: 'power3.out', stagger: .12, invalidateOnRefresh: true,
        scrollTrigger: { trigger: deck, start: 'top 92%', end: 'top 38%', scrub: .9 } });
    // The closing picture rises out of the page edge as it scrolls in.
    gsap.fromTo('.outro canvas', { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', scrollTrigger: { trigger: '.outro', start: 'clamp(top 95%)', end: 'clamp(top 40%)', scrub: .6 } });
    enter('.outro p span', '.outro p', { y: 10, stagger: .12, scrollTrigger: { trigger: '.outro p', start: 'top 98%', once: true } });

    // 3. Bento cards enter together, then each one plays its own loop while visible.
    gsap.from('.cell', { y: 60, opacity: 0, duration: 1.3, stagger: .09, ease: 'expo.out', scrollTrigger: { trigger: '.bento', start: 'top 80%', once: true } });

    const hl = document.querySelector('[data-cell="hl"]');
    const marks = $('.hl', hl), sw = $('.swatches i', hl), pin = hl.querySelector('.pin');
    const pick = i => () => sw.forEach((s, j) => s.classList.toggle('cur', i === j));
    gsap.timeline({ repeat: -1, repeatDelay: 1.2, scrollTrigger: live(hl) })
      .set(marks, { backgroundSize: '0% 100%' }).set(pin, { opacity: 0, y: 12, scale: .96 }).call(pick(-1))
      .call(pick(0), null, .4).to(marks[0], { backgroundSize: '100% 100%', duration: .9, ease: 'power2.inOut' }, .7)
      .call(pick(1), null, 2).to(marks[1], { backgroundSize: '100% 100%', duration: .9, ease: 'power2.inOut' }, 2.3)
      .to(pin, { opacity: 1, y: 0, scale: 1, duration: .6, ease: 'expo.out' }, 3.5)
      .to({}, { duration: 2.5 });

    // Spreadsheet card: the same rows flip between table and source view, like Doko's CSV editor.
    const table = document.querySelector('[data-cell="table"] .tmini');
    const asSource = on => () => table.classList.toggle('as-src', on);
    gsap.timeline({ repeat: -1, scrollTrigger: live(table) })
      .from($('.grid span', table), { opacity: 0, y: 6, duration: .5, stagger: .04, ease: 'power2.out' })
      .call(asSource(true), null, '+=1.8')
      .call(asSource(false), null, '+=2.2')
      .to({}, { duration: .6 });

    const md = document.querySelector('[data-cell="md"]');
    gsap.timeline({ repeat: -1, repeatDelay: 1.5, scrollTrigger: live(md) })
      .fromTo($('.md-src span', md), { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: .5, stagger: .45, ease: 'steps(10)' })
      .fromTo($('.md-out > *', md), { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: .4, stagger: .45, ease: 'power2.out' }, .3)
      .to({}, { duration: 2.2 });

    const reels = $('[data-cell="photo"] .reel-track'); // colour track and its dithered twin move as one
    gsap.to(reels, { xPercent: -50, duration: 30, ease: 'none', repeat: -1, scrollTrigger: live(reels[0]) });

    const sign = document.querySelector('[data-cell="sign"]');
    const stroke = draw($('.sig path', sign));
    gsap.timeline({ repeat: -1, repeatDelay: 1.4, scrollTrigger: live(sign) })
      .set(stroke, { strokeDashoffset: (i, p) => p.getTotalLength() })
      .to(stroke, { strokeDashoffset: 0, duration: 2.2, ease: 'power1.inOut' })
      .to({}, { duration: 1.6 });

    const pagesCell = document.querySelector('[data-cell="pages"]');
    const pg = $('.pages i', pagesCell);
    const gap = () => pg[2].offsetLeft - pg[1].offsetLeft;
    gsap.timeline({ repeat: -1, repeatDelay: 1, scrollTrigger: live(pagesCell) })
      .to(pg[1], { x: gap, y: -10, duration: .7, ease: 'power3.inOut' })
      .to(pg[2], { x: () => -gap(), y: 10, duration: .7, ease: 'power3.inOut' }, '<')
      .to([pg[1], pg[2]], { y: 0, duration: .3 }, '>-.1')
      .to(pg[3], { rotation: 90, duration: .6, ease: 'expo.inOut' }, '+=.5')
      .to(pg[3], { rotation: 0, duration: .6, ease: 'expo.inOut' }, '+=.6')
      .to([pg[1], pg[2]], { x: 0, duration: .7, ease: 'power3.inOut' }, '+=.6');

    pulse(document.querySelector('.local'));

    const narrow = () => matchMedia('(max-width: 720px)').matches;
    const answers = [...lock.querySelectorAll('.lock-ans span')], ansBox = lock.querySelector('.lock-ans');
    const lockTl = gsap.timeline({ repeat: -1, scrollTrigger: live(lock) });
    [1, 2, 0].forEach((i, r) => {
      const at = r * 4.6;
      lockTl.to(ansBox, { opacity: 0, y: 6, duration: .3 }, at);
      picks.forEach((pick, n) => {
        const rows = [...pick.children], t0 = at + .3 + n * .22;
        lockTl.to(rows, { y: () => -i * rows[0].offsetHeight, duration: .85, ease: 'expo.inOut' }, t0)
          .to(pick, { width: () => fitPick(pick, i), duration: .85, ease: 'expo.inOut' }, t0);
        rows.forEach((row, j) => { const d = Math.abs(j - i);
          lockTl.to(row, { opacity: () => d === 0 ? 1 : d === 1 && !narrow() ? .16 : 0, filter: d ? 'blur(1.5px)' : 'blur(0px)', duration: .75, ease: 'expo.inOut' }, t0 + .05); });
      });
      lockTl.to(picks[2], { scale: 1.14, duration: .2, yoyo: true, repeat: 1, ease: 'power2.out' }, at + 1.6)
        .call(() => answers.forEach((s, j) => s.classList.toggle('on', j === i)), null, at + 1.7)
        .to(ansBox, { opacity: 1, y: 0, duration: .5, ease: 'expo.out' }, at + 1.75);
    });
    lockTl.to({}, { duration: .01 }, 3 * 4.6); // hold the last answer before the loop restarts
    const relock = () => lockTl.invalidate();
    ScrollTrigger.addEventListener('refreshInit', relock);
    // matchMedia reverts styles, not classes: restore the resting state.
    return () => { ScrollTrigger.removeEventListener('refreshInit', relock); window.removeEventListener('wires', rerun); sparkCtx?.revert(); asSource(false)(); sw.forEach(s => s.classList.remove('cur')); };
  });

}
