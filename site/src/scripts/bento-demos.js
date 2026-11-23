// Bento cards as live Doko demos: a named cursor performs the feature in a small copy of the app window.
// The markup's resting state is the finished result, so with reduced motion (no call here) every card is complete.
import { gsap } from "gsap";

// Box of `el` in the demo root's own (unscaled) coordinates. The root itself is the "camera": it zooms with
// transform-origin 0 0, so screen distances are divided by its scale. Measured when a tween starts.
const box = (root, el) => {
  const r = el.getBoundingClientRect(), o = root.getBoundingClientRect(), z = gsap.getProperty(root, "scale") || 1;

  return { x: (r.left - o.left) / z, y: (r.top - o.top) / z, w: r.width / z, h: r.height / z };
};

export function bentoDemos(live) {
  const timelines = [], snapshots = [];

  const scene = (cell, build) => {
    const root = document.querySelector(`[data-cell="${cell}"] .demo`);

    if (!root) return;
    snapshots.push([root, root.innerHTML]); // classes and text the loops change; restored when motion stops
    const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
    const ptr = q('.ptr');
    const tl = gsap.timeline({ repeat: -1, repeatDelay: .8, scrollTrigger: live(root) });

    // Point at a spot of an element: fx/fy are fractions of its box.
    const at = (el, fx = .5, fy = .5) => () => { const b = box(root, typeof el === 'function' ? el() : el);

 return { x: b.x + b.w * fx, y: b.y + b.h * fy }; };

    // A hand moves in arcs: x and y ease differently, so the path curves instead of running on a ruler.
    const move = (target, t, d = .7) => tl.to(ptr, { x: () => target().x, duration: d, ease: 'power3.inOut' }, t)
      .to(ptr, { y: () => target().y, duration: d, ease: 'power2.inOut' }, t);

    // A click: the cursor dips, a soft ring opens where it landed, and the pressed control (if given) gives way.
    const ring = document.createElement('i'); ring.className = 'tap'; root.append(ring);

    const click = (t, el) => {
      tl.to(ptr, { scale: .82, duration: .08, yoyo: true, repeat: 1, ease: 'power1.inOut' }, t)
        .fromTo(ring, { x: () => gsap.getProperty(ptr, 'x'), y: () => gsap.getProperty(ptr, 'y'), scale: .2, opacity: .9 }, { scale: 1, opacity: 0, duration: .55, ease: 'expo.out', immediateRender: false }, t);

      if (el) tl.to(el, { scale: .94, duration: .08, yoyo: true, repeat: 1, ease: 'power1.inOut' }, t);
    };

    // The camera leans in on the action (z > 1) and back out (z = 1), keeping the chosen point steady.
    const cam = (point, z, t, d = 1.1) => tl.to(root, { scale: z, x: () => -point().x * (z - 1), y: () => -point().y * (z - 1), duration: d, ease: 'power2.inOut' }, t);

    // People type in bursts: a little jitter in the rhythm reads as a hand, not a script.
    const type = (el, text, t, step = .05) => { tl.call(() => { el.textContent = ''; }, null, t); let at2 = t; [...text].forEach((ch, n) => { tl.call(() => { el.textContent += ch; }, null, at2); at2 += step * (ch === ' ' ? 1.8 : .7 + ((n * 37) % 7) / 10); });

 return at2; };

    tl.set(root, { scale: 1, x: 0, y: 0, transformOrigin: '0 0' }, 0)
      .set(ptr, { opacity: 1, x: () => root.clientWidth * .78, y: () => root.clientHeight * .85 }, 0);
    build({ root, tl, q, qa, ptr, at, move, click, type, cam });
    cam(() => ({ x: 0, y: 0 }), 1, tl.duration(), .8); // end every loop wide, ready to start again
    tl.timeScale(.75); // unhurried: each step reads before the next starts
    timelines.push(tl);
  };

  // Highlight: select a phrase, pick a colour in the selection bar, type a note, watch it land in Notes.
  scene('hl', ({ root, tl, q, qa, at, move, click, type, cam }) => {
    const marks = qa('.mk'), notes = qa('.hl-note'), sel = q('.sel'), bar = q('.hl-bar'), dots = qa('.hl-bar > i'), field = q('.hl-field');

    const first = m => () => { const r = m.getClientRects()[0], o = root.getBoundingClientRect(), z = gsap.getProperty(root, 'scale') || 1;

 return { x: (r.left - o.left) / z, y: (r.top - o.top) / z, w: r.width / z, h: r.height / z }; };

    tl.set(marks, { '--hw': '0%' }, 0).set(notes, { opacity: 0, x: -12 }, 0).set([sel, bar], { opacity: 0 }, 0);
    [[0, 1], [1, 0]].forEach(([m, c], k) => {
      const t = .4 + k * 5.4, fr = first(marks[m]);
      cam(() => ({ x: fr().x + fr().w / 2, y: fr().y }), 1.24, t, 1.2);
      move(() => ({ x: fr().x, y: fr().y + fr().h * .6 }), t, .8);
      tl.set(sel, { x: () => fr().x, y: () => fr().y, height: () => fr().h, width: 0, opacity: 1 }, t + .85)
        .to(sel, { width: () => fr().w, duration: .7, ease: 'power2.inOut' }, t + .9)
        .to(root.querySelector('.ptr'), { x: () => fr().x + fr().w, duration: .7, ease: 'power2.inOut' }, t + .9)
        .fromTo(bar, { opacity: 0, scale: .96, x: () => Math.max(8, fr().x + fr().w / 2 - bar.offsetWidth / 2), y: () => fr().y + fr().h + 4 },
          { opacity: 1, scale: 1, y: () => fr().y + fr().h + 10, duration: .35, ease: 'back.out(2)', immediateRender: false }, t + 1.65);
      move(at(dots[c]), t + 1.95, .55);
      click(t + 2.5, dots[c]);
      tl.call(() => dots.forEach((d, j) => d.classList.toggle('on', j === c)), null, t + 2.5)
        .to(sel, { opacity: 0, duration: .2 }, t + 2.55)
        .fromTo(marks[m], { '--hw': '0%' }, { '--hw': '100%', duration: .55, ease: 'power2.out' }, t + 2.6);
      move(at(field, .15), t + 2.9, .45);
      const done = type(field, notes[m].querySelector('small').textContent, t + 3.4, .045);
      cam(() => ({ x: 0, y: 0 }), 1, done, .9);
      tl.to(notes[m], { opacity: 1, x: 0, duration: .5, ease: 'expo.out' }, done + .15)
        .to(bar, { opacity: 0, duration: .25 }, done + .2)
        .call(() => { dots.forEach(d => d.classList.remove('on')); field.textContent = ''; }, null, done + .5);
    });
    tl.to({}, { duration: 1.4 });
  });

  // Spreadsheet: edit one cell, then the Source view shows that only its line changed.
  scene('table', ({ tl, q, qa, at, move, click, type, cam }) => {
    const cell = q('.tb-cell'), tabs = qa('.seg b'), grid = q('.tb-grid'), src = q('.tb-src'), was = cell.textContent;
    const tab = i => () => tabs.forEach((b, j) => b.classList.toggle('on', i === j));
    tl.call(() => { cell.textContent = was; cell.classList.remove('edit', 'changed'); tab(0)(); }, null, 0).set(src, { opacity: 0 }, 0).set(grid, { opacity: 1 }, 0);
    cam(at(cell), 1.34, .3, 1.3);
    move(at(cell), .4);
    click(1.15, cell); click(1.35, cell);
    tl.call(() => cell.classList.add('edit'), null, 1.4);
    const done = type(cell, '32', 1.7, .18);
    tl.call(() => { cell.classList.remove('edit'); cell.classList.add('changed'); }, null, done + .4);
    cam(() => ({ x: 0, y: 0 }), 1, done + .5, .9);
    move(at(tabs[1]), done + .7, .6);
    click(done + 1.35, tabs[1]);
    tl.call(tab(1), null, done + 1.4).to(grid, { opacity: 0, duration: .3 }, done + 1.4).to(src, { opacity: 1, duration: .35 }, done + 1.5)
      .to({}, { duration: 2 });
    move(at(tabs[0]), done + 3.6, .5);
    click(done + 4.15, tabs[0]);
    tl.call(tab(0), null, done + 4.2).to(src, { opacity: 0, duration: .3 }, done + 4.2).to(grid, { opacity: 1, duration: .3 }, done + 4.3).to({}, { duration: 1 });
  });

  // Markdown: tick a task, save to the original file, peek at the source.
  scene('md', ({ tl, q, at, move, click, cam }) => {
    const todo = q('.md-todo'), save = q('.md-save'), view = q('.md-view'), doc = q('.md-doc'), src = q('.md-srcv');
    tl.call(() => { todo.classList.remove('done'); save.classList.add('dirty'); save.textContent = 'Save'; view.classList.remove('on'); }, null, 0)
      .set(src, { opacity: 0 }, 0).set(doc, { opacity: 1 }, 0);
    cam(at(todo), 1.3, .3, 1.2);
    move(at(todo), .4);
    click(1.15, todo);
    tl.call(() => todo.classList.add('done'), null, 1.2);
    cam(() => ({ x: 0, y: 0 }), 1, 1.5, .8);
    move(at(save), 1.6, .6);
    click(2.3, save);
    tl.call(() => { save.classList.remove('dirty'); save.textContent = 'Saved'; }, null, 2.35);
    move(at(view), 3, .55);
    click(3.65, view);
    tl.call(() => view.classList.add('on'), null, 3.7).to(doc, { opacity: 0, duration: .3 }, 3.7).to(src, { opacity: 1, duration: .35 }, 3.8)
      .to({}, { duration: 2 }).call(() => view.classList.remove('on')).to(src, { opacity: 0, duration: .3 }).to(doc, { opacity: 1, duration: .3 }, '<.1');
  });

  // Signature: open Sign, drag the saved signature onto the line, resize it, approve.
  scene('sign', ({ root, tl, q, at, move, click, cam }) => {
    const tabEl = q('.sg-tab'), panel = q('.sg-panel'), thumb = q('.sg-thumb'), stamp = q('.sg-stamp'), boxEl = q('.sg-box'), ok = q('.sg-ok');
    tl.set(panel, { opacity: 0, y: -6 }, 0).set(boxEl, { opacity: 0 }, 0).set(ok, { opacity: 0 }, 0).set(stamp, { opacity: 0, x: 0, y: 0, scale: 1 }, 0)
      .call(() => tabEl.classList.remove('on'), null, 0);
    move(at(tabEl), .3, .6);
    click(.95, tabEl);
    tl.call(() => tabEl.classList.add('on'), null, 1).to(panel, { opacity: 1, y: 0, duration: .35, ease: 'back.out(2)' }, 1);
    move(at(thumb), 1.4, .55);
    click(2, thumb);
    cam(at(stamp, .4, .5), 1.28, 2.1, 1.4);
    // the stamp starts where the thumbnail is and travels with the cursor to the signature line
    tl.set(stamp, { opacity: .85, x: () => box(root, thumb).x - box(root, stamp).x, y: () => box(root, thumb).y - box(root, stamp).y, scale: () => thumb.getBoundingClientRect().width / stamp.getBoundingClientRect().width, transformOrigin: '0 0' }, 2.05)
      .to(stamp, { x: 0, y: 0, scale: 1, opacity: 1, duration: .9, ease: 'power3.inOut' }, 2.1)
      .to(panel, { opacity: 0, duration: .25 }, 2.1);
    move(at(stamp, .1, .5), 2.1, .9);
    tl.to(boxEl, { opacity: 1, duration: .2 }, 3.05);
    move(at(stamp, 1, 1), 3.3, .5);
    tl.to(stamp, { scale: 1.12, duration: .5, ease: 'power2.inOut' }, 3.9);
    move(() => { const b = box(root, stamp);

 return { x: b.x + b.w * 1.12, y: b.y + b.h * 1.12 }; }, 3.9, .5);
    tl.set(ok, { x: () => box(root, stamp).x + box(root, stamp).w * .3 - box(root, ok).x + gsap.getProperty(ok, 'x'), y: () => box(root, stamp).y + box(root, stamp).h * 1.25 - box(root, ok).y + gsap.getProperty(ok, 'y') }, 4.5)
      .to(ok, { opacity: 1, duration: .3 }, 4.5);
    cam(() => ({ x: 0, y: 0 }), 1, 4.2, .8); // step back so Approve, below the line, is in view
    move(at(ok), 4.7, .5);
    click(5.25, ok);
    tl.to([boxEl, ok], { opacity: 0, duration: .25 }, 5.3).call(() => tabEl.classList.remove('on'), null, 5.3).to({}, { duration: 1.8 });
  });

  // Pages: drag page 3 before page 2, rotate page 4, save a copy.
  scene('pages', ({ tl, q, qa, at, move, click, cam }) => {
    const pgs = qa('.pg'), gap = () => pgs[2].offsetLeft - pgs[1].offsetLeft, save = q('.pg-save'), toast = q('.pg-toast');
    tl.set(pgs, { x: 0, y: 0, scale: 1, zIndex: 0 }, 0).set(pgs[3].querySelector('.pg-paper'), { rotation: 0 }, 0).set(toast, { opacity: 0, y: 6 }, 0)
      .call(() => pgs.forEach(p => p.classList.remove('lift', 'hover')), null, 0);
    cam(at(pgs[2], 0, .5), 1.22, .3, 1.3);
    move(at(pgs[2], .5, .4), .4);
    tl.call(() => pgs[2].classList.add('lift'), null, 1.15).to(pgs[2], { scale: 1.06, y: -6, zIndex: 2, duration: .2 }, 1.15);
    const grab = at(pgs[2], .5, .4);
    tl.to(pgs[2], { x: () => -gap(), duration: .8, ease: 'power3.inOut' }, 1.4)
      .to(pgs[1], { x: () => gap(), duration: .8, ease: 'power3.inOut' }, 1.5);
    move(() => ({ x: grab().x - gap(), y: grab().y }), 1.4, .8);
    tl.to(pgs[2], { scale: 1, y: 0, duration: .25 }, 2.25).call(() => pgs[2].classList.remove('lift'), null, 2.3);
    move(at(pgs[3], .5, .4), 2.6, .6);
    tl.call(() => pgs[3].classList.add('hover'), null, 3.1);
    move(at(pgs[3].querySelector('.pg-rot')), 3.3, .35);
    click(3.7, pgs[3].querySelector('.pg-rot'));
    tl.to(pgs[3].querySelector('.pg-paper'), { rotation: 90, duration: .6, ease: 'expo.inOut' }, 3.75).call(() => pgs[3].classList.remove('hover'), null, 4.2);
    cam(() => ({ x: 0, y: 0 }), 1, 4.2, .9);
    move(at(save), 4.4, .6);
    click(5.05, save);
    tl.to(toast, { opacity: 1, y: 0, duration: .35, ease: 'back.out(2)' }, 5.1).to({}, { duration: 1.8 }).to(toast, { opacity: 0, duration: .3 })
      .to([pgs[1], pgs[2]], { x: 0, duration: .7, ease: 'power3.inOut' }).to(pgs[3].querySelector('.pg-paper'), { rotation: 0, duration: .6, ease: 'expo.inOut' }, '<');
  });

  // Photos: crop by dragging a corner, apply, then step to the next photo in the folder.
  scene('photo', ({ tl, q, qa, at, move, click, cam }) => {
    const tab = q('.ph-crop-tab'), apply = q('.ph-apply'), frame = q('.ph-frame'), [cur, next] = qa('.ph-pic img'), thumbs = qa('.ph-strip img');
    tl.set(frame, { opacity: 0, width: '100%', height: '100%' }, 0).set(apply, { opacity: 0 }, 0).set(cur, { scale: 1, opacity: 1 }, 0).set(next, { opacity: 0 }, 0)
      .call(() => { tab.classList.remove('on'); thumbs.forEach((t, i) => t.classList.toggle('on', !i)); }, null, 0);
    move(at(tab), .4);
    click(1.1, tab);
    tl.call(() => tab.classList.add('on'), null, 1.15).to(frame, { opacity: 1, duration: .25 }, 1.15).to(apply, { opacity: 1, duration: .25 }, 1.15);
    cam(at(frame, .5, .5), 1.18, 1.3, 1.6);
    move(at(frame, 1, 1), 1.4, .6);
    tl.to(frame, { width: '72%', height: '74%', duration: .9, ease: 'power2.inOut' }, 2.1);
    move(() => { const f = at(frame, 1, 1)();

 return { x: f.x - (f.x - at(frame, 0, 0)().x) * .28, y: f.y - (f.y - at(frame, 0, 0)().y) * .26 }; }, 2.1, .9);
    move(at(apply), 3.2, .6);
    click(3.85, apply);
    cam(() => ({ x: 0, y: 0 }), 1, 3.9, .9);
    tl.call(() => tab.classList.remove('on'), null, 3.9).to([frame, apply], { opacity: 0, duration: .25 }, 3.9)
      .to(cur, { scale: 1.36, transformOrigin: '0% 0%', duration: .8, ease: 'expo.inOut' }, 3.95);
    move(at(thumbs[1]), 4.9, .6);
    click(5.55, thumbs[1]);
    tl.call(() => thumbs.forEach((t, i) => t.classList.toggle('on', i === 1)), null, 5.6).to(next, { opacity: 1, duration: .5 }, 5.6).to({}, { duration: 1.8 });
  });

  // Canvas: draw a box, type its label, draw an arrow, then ask AI to finish the diagram.
  scene('canvas', ({ tl, q, qa, at, move, click, type, cam }) => {
    const [rectTool, arrowTool] = qa('.cv-tool'), aiBtn = q('.cv-ai'), ask = q('.cv-ask'), field = q('.cv-field'), prompt = field.textContent;
    const [box, arrow] = qa('.cv-you .cv-draw'), label = q('.cv-you .cv-label'), word = label.textContent;
    const made = qa('.cv-ai-made > *');
    const tool = el => () => [rectTool, arrowTool, aiBtn].forEach(b => b.classList.toggle('on', b === el));

    // round line caps show as dots at offset 1, so each stroke stays hidden until it starts drawing; fills follow the stroke
    const draw = (el, t, d) => tl.set(el, { opacity: 1 }, t).to(el, { strokeDashoffset: 0, duration: d, ease: 'power2.inOut' }, t)
      .to(el, { fillOpacity: 1, duration: .4 }, t + d * .7);

    tl.set([box, arrow, ...made], { strokeDashoffset: 1, opacity: 0, fillOpacity: 0 }, 0)
      .set(ask, { opacity: 0, y: 8 }, 0).call(() => { label.textContent = ''; field.textContent = ''; tool(null)(); }, null, 0);
    move(at(rectTool), .3, .6);
    click(.95, rectTool);
    tl.call(tool(rectTool), null, 1);
    cam(at(box, .5, .5), 1.25, 1.1, 1.2);
    move(at(box, 0, 0), 1.2, .6);
    draw(box, 1.9, .9);
    move(at(box, 1, 1), 1.9, .9);
    const typed = type(label, word, 3, .07);
    cam(() => ({ x: 0, y: 0 }), 1, typed + .1, .8);
    move(at(arrowTool), typed + .1, .6);
    click(typed + .75, arrowTool);
    tl.call(tool(arrowTool), null, typed + .8);
    move(at(arrow, 0, .5), typed + 1, .5);
    draw(arrow, typed + 1.55, .6);
    move(at(arrow, 1, .5), typed + 1.55, .6);
    const t = typed + 2.4;
    move(at(aiBtn), t, .6);
    click(t + .65, aiBtn);
    tl.call(tool(aiBtn), null, t + .7).to(ask, { opacity: 1, y: 0, duration: .35, ease: 'power3.out' }, t + .7);
    move(at(field, .1), t + .9, .5);
    const asked = type(field, prompt, t + 1.5, .045);
    click(asked + .3, q('.cv-ask b'));
    tl.to(ask, { opacity: 0, y: 8, duration: .3 }, asked + .5).call(tool(null), null, asked + .5);
    made.forEach((el, k) => el.matches('text') ? tl.to(el, { opacity: 1, fillOpacity: 1, duration: .4 }, asked + .7 + k * .22) : draw(el, asked + .7 + k * .22, .7));
    tl.to({}, { duration: 2.2 });
  });

  // Positions are measured when tweens first run; after a resize they must be measured again.
  let pending = 0;
  const remeasure = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => timelines.forEach(t => t.invalidate())); };

  addEventListener('resize', remeasure);

  return () => {
    removeEventListener('resize', remeasure);
    cancelAnimationFrame(pending);
    snapshots.forEach(([root, html]) => { root.innerHTML = html; });
  };
}
