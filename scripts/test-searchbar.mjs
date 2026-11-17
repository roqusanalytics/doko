import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync(new URL("../src/SearchBar.tsx", import.meta.url), "utf8");
const body = stripTypeScriptTypes(source.slice(source.indexOf('  const [query,'), source.indexOf('  const status =')));
const render = new Function("useState", "useRef", "useEffect", "window", "onFind", body + ";return step;");
const timers = new Map(), refs = [], calls = [];
let nextTimer = 0, cleanup, previousDeps;
const clock = { setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); } };
function draw(query) {
  let state = 0, ref = 0;
  return render(() => [[query, false, false][state++], () => {}], value => refs[ref++] ??= { current: value }, (effect, deps) => {
    if (!previousDeps || deps.some((value, index) => value !== previousDeps[index])) {
      cleanup?.(); previousDeps = deps; cleanup = effect();
    }
  }, clock, (...args) => calls.push(args));
}
const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
draw(""); flush(); assert.equal(calls.length, 0, "initial empty field must not index");
draw("the")(false); // Enter before the typing debounce fires.
draw(""); flush();
assert.deepEqual(calls.map(([query]) => query), ["the", ""], "clearing immediately after Enter clears native matches");
draw("again"); flush(); draw(""); flush();
assert.deepEqual(calls.map(([query]) => query), ["the", "", "again", ""]);
draw("previous")(true); draw(""); flush();
assert.deepEqual(calls.slice(-2).map(([query]) => query), ["previous", ""]);
assert.equal(calls.at(-2)[1].previous, true);
assert.equal(timers.size, 0);
console.log("PASS initial empty search, Enter then immediate clear, debounced search and clear");
