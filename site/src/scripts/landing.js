import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import "./texture.js"; // builds the dithered reel track before the motion below animates it

// Hero tabs: arrow keys move between files; the demo advances on its own until someone interacts.
const tabs = [...document.querySelectorAll('[role="tab"]')];
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
let timer = null;
function show(i, focus) {
  tabs.forEach((t, j) => {
    const on = i === j;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).classList.toggle('on', on);
  });
  document.querySelectorAll('.tagx[data-tab]').forEach(p => p.classList.toggle('on', +p.dataset.tab === i));
  if (focus) tabs[i].focus();
}
const current = () => tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
const stop = () => { clearInterval(timer); timer = null; };
tabs.forEach((t, i) => {
  t.addEventListener('click', () => { stop(); show(i); });
  t.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); stop(); show(e.key === 'Home' ? 0 : tabs.length - 1, true); }
    if (step) { e.preventDefault(); stop(); show((i + step + tabs.length) % tabs.length, true); }
  });
});
document.querySelectorAll('.tagx[data-tab]').forEach(p => p.addEventListener('click', () => { stop(); show(+p.dataset.tab); }));
if (!calm) {
  // One pass through the three files, then it stops (WCAG 2.2.2); any hover or focus stops it sooner.
  let steps = 0;
  timer = setInterval(() => { if (document.hidden) return; show((current() + 1) % tabs.length); if (++steps >= tabs.length - 1) stop(); }, 4800);
  document.querySelector('.window').addEventListener('pointerenter', stop, { once: true });
  document.querySelector('.window').addEventListener('focusin', stop, { once: true });
}

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
    for (const o of [-10, -5, 0, 5, 10]) out += `<path class="w" stroke="${c}" d="${curve(o)}"/>`;
    out += `<path class="spark" data-i="${i}" stroke="${c}" d="${curve(0)}"/>`;
  });
  wiresSvg.innerHTML = out;
}
drawWires();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { drawWires(); window.dispatchEvent(new Event('wires')); });
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
  })
  .catch(err => console.warn('Direct download links unavailable, using the release page.', err));

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
    const runWires = (intro) => {
      sparkCtx?.revert();
      sparkCtx = gsap.context(() => {
        const lines = [...wiresSvg.querySelectorAll('.w')];
        if (intro) lines.forEach(p => { const len = p.getTotalLength(); gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.4, ease: 'expo.inOut', delay: 1 + Math.random() * .5 }); });
        wiresSvg.querySelectorAll('.spark').forEach(p => {
          const len = p.getTotalLength(), seg = 34;
          gsap.timeline({ repeat: -1, repeatDelay: 1 + Math.random() * 2.5, delay: (intro ? 2.2 : 0) + Math.random() * 2, scrollTrigger: live(scene) })
            .set(p, { strokeDasharray: `${seg} ${len}`, strokeDashoffset: seg, opacity: 1 })
            .to(p, { strokeDashoffset: -len, duration: 1.3, ease: 'power2.in' })
            .set(p, { opacity: 0 });
        });
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
    enter('.platforms li', '.platforms', { y: 60, rotateX: -22, transformPerspective: 900, transformOrigin: '50% 100%', stagger: .1 });
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

    const ai = document.querySelector('[data-cell="ai"]');
    const provs = $('.prov', ai), ask = ai.querySelector('.ask');
    const turn = i => () => provs.forEach((p, j) => p.classList.toggle('on', i === j));
    const aiTl = gsap.timeline({ repeat: -1, scrollTrigger: live(ai) });
    provs.forEach((_, i) => aiTl.call(turn(i)).fromTo(ask, { scale: 1 }, { scale: 1.08, duration: .35, yoyo: true, repeat: 1, ease: 'power2.inOut' }, '+=.5').to({}, { duration: 1.2 }));
    gsap.from($('.prov', ai), { y: 18, opacity: 0, duration: 1, stagger: .12, ease: 'expo.out', scrollTrigger: { trigger: ai, start: 'top 80%', once: true } });

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
    // matchMedia reverts styles, not classes: restore the resting state.
    return () => { window.removeEventListener('wires', rerun); sparkCtx?.revert(); turn(0)(); sw.forEach(s => s.classList.remove('cur')); };
  });

  // Flow nodes: hover, focus or tap one and only its wire carries light; the rest dims.
  // Nodes and wires share one order: inputs 1-3, outputs 1-3.
  document.querySelectorAll('.flow').forEach(svg => {
    const nodes = [...svg.querySelectorAll('.node')], wires = [...svg.querySelectorAll('.wire')], dots = [...svg.querySelectorAll('.dot')];
    const pick = i => {
      svg.classList.toggle('has-sel', i >= 0);
      [nodes, wires, dots].forEach(list => list.forEach((el, j) => el.classList.toggle('sel', j === i)));
    };
    nodes.forEach((n, i) => {
      n.setAttribute('tabindex', 0); n.setAttribute('role', 'button'); n.setAttribute('aria-label', n.textContent.trim());
      n.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') pick(i); });
      n.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') pick(-1); });
      n.addEventListener('focus', () => pick(i));
      n.addEventListener('blur', () => pick(-1));
      n.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') pick(i); }); // touch has no hover; focus covers keyboard and mouse
    });
    document.addEventListener('pointerdown', e => { if (!svg.contains(e.target)) pick(-1); });
  });

  // 4. Flow diagram, kept separate so crossing the breakpoint rebuilds only this.
  mm.add({ motion: '(prefers-reduced-motion: no-preference)', wide: '(min-width: 721px)' }, ctx => {
    const { motion, wide } = ctx.conditions;
    if (!motion) return;
    const svg = document.querySelector(wide ? '.flow-h' : '.flow-v');
    const inWires = draw($('.wire.a', svg)), outWires = draw($('.wire.b', svg));
    gsap.timeline({ scrollTrigger: { trigger: svg, start: 'top 70%', once: true }, onComplete: () => ctx.add(() => pulse(svg)) })
      .from($('.node.in', svg), { opacity: 0, x: wide ? -24 : 0, y: wide ? 0 : -16, duration: .6, stagger: .1, ease: 'expo.out' })
      .to(inWires, { strokeDashoffset: 0, duration: .9, stagger: .08, ease: 'power2.inOut' }, '-=.2')
      .from($('.hub', svg), { scale: .5, opacity: 0, transformOrigin: '50% 50%', duration: .8, ease: 'expo.out' }, '-=.35')
      .to(outWires, { strokeDashoffset: 0, duration: .9, stagger: .08, ease: 'power2.inOut' }, '-=.3')
      .from($('.node.out', svg), { opacity: 0, x: wide ? 24 : 0, y: wide ? 0 : 16, duration: .6, stagger: .1, ease: 'expo.out' }, '-=.4')
      .from('.answer .q', { opacity: 0, y: 16, duration: .7, ease: 'expo.out' })
      .from('.answer .a', { opacity: 0, y: 16, clipPath: 'inset(0 100% 0 0)', duration: 1.1, ease: 'expo.out' }, '+=.3')
      .from('.answer .cite', { scale: .4, opacity: 0, duration: .6, ease: 'expo.out' }, '-=.3');
  });
}
