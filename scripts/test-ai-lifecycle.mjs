// Real extraction helper and registered AI handlers; all provider I/O and clocks are offline fakes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(new URL("../electron/ai.cjs", import.meta.url));

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });

  return { promise, resolve, reject };
};

const drain = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const pdf = { kind: "pdf", name: "test", text: "test", truncated: false };
let passed = 0;

async function check(name, test) { await test(); passed++; console.log(`ok ${name}`); }


function backend(fetch, expired = true) {
  const timers = new Map(); let nextTimer = 0; let now = 0;
  const handlers = new Map(), events = [];

  const sandbox = {
    module: { exports: {} }, console, process, Buffer, URL, URLSearchParams, TextDecoder, AbortController, AbortSignal,
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: now + ms });

 return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === "electron") return { app: { getPath: () => "/unused-ai-lifecycle-test" }, net: { fetch },
        safeStorage: { isAsyncEncryptionAvailable: async () => false } };

      if (name === "node:fs") return { readdirSync: () => [], readFileSync: () => '{"hostId":"test","clientId":"test"}' };

      return require(name);
    },
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL("../electron/ai.cjs", import.meta.url), "utf8"), context);
  vm.runInContext(`session = { accessToken: "fake", refreshToken: "fake-refresh", expiresAt: ${expired ? 0 : Date.now() + 3_600_000} };`, context);
  sandbox.module.exports.register((name, fn) => handlers.set(name, fn), (_name, event) => events.push(event));

  return {
    events, timers,
    ask(id, document = pdf, context) { return handlers.get("folio:ai-ask")(null, { id, provider: "chatgpt", model: "test",
      document, messages: [{ role: "user", content: "test", context }] }); },
    cancel(id) { handlers.get("folio:ai-cancel")(null, id); },
    async tick(ms) {
      const end = now + ms;

      for (;;) {
        await drain();
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];

        if (!due) break;
        const [id, timer] = due; timers.delete(id); now = timer.at; timer.fn();
      }

      now = end; await drain();
    },
  };
}

const tokens = () => ({ ok: true, text: async () => JSON.stringify({ access_token: "fake-new", expires_in: 3600 }) });

function response(chunks = ['data: {"type":"response.completed"}\n\n'], stall = false, stallCancel = false) {
  let index = 0;

  return { ok: true, status: 200, body: { getReader: () => ({
    read: async () => index < chunks.length ? { value: new TextEncoder().encode(chunks[index++]), done: false }
      : stall ? new Promise(() => {}) : { done: true },
    cancel: async () => stallCancel ? new Promise(() => {}) : undefined,
  }) } };
}

await check("missing and unsupported document kinds are rejected before provider access", async () => {
  let requests = 0;

  const b = backend(async () => { requests++;

 return response(); }, false);

  const { kind, ...untyped } = pdf;

  for (const document of [untyped, { ...pdf, kind: "workbook" }, { ...pdf, kind: "" }, { ...pdf, kind: 1 }]) {
    assert.throws(() => b.ask("invalid", document), /Invalid request/);
  }

  await drain();
  assert.equal(requests, 0);
});

await check("Markdown uses its own instructions and sends a selection without PDF page markers", async () => {
  const requests = [];

  const b = backend(async (_url, options) => { requests.push(JSON.parse(options.body));

 return response(); }, false);

  const markdown = { ...pdf, kind: "markdown", text: "# Plan\n\nLaunch pilot." };
  assert.throws(() => b.ask("invalid", { ...markdown, text: "a".repeat(400_001) }), /Invalid request/);
  assert.throws(() => b.ask("invalid", markdown, { text: "test", page: 1 }), /Invalid request/);
  assert.throws(() => b.ask("invalid", markdown, { text: "x".repeat(12_001) }), /Invalid request/);
  b.ask("valid", markdown, { text: "Launch pilot." }); await drain();
  assert.equal(requests.length, 1);
  assert.match(requests[0].instructions, /doko-edit/);
  assert.deepEqual(JSON.parse(requests[0].input[0].content).document, markdown);
  assert.deepEqual(JSON.parse(requests[0].input[1].content).selectedPassage, { text: "Launch pilot." });
});

await check("completed answers release slots even when the transport stays open", async () => {
  const b = backend(async () => response(['data: {"type":"response.output_text.delta","delta":"Complete answer"}\n\n',
    'data: {"type":"response.completed"}\n\n'], true, true), false);

  b.ask("complete"); await drain();
  assert.deepEqual(b.events.map(event => event.type), ["delta", "done"]);
  assert.equal(b.timers.size, 0);
  await b.tick(300_000);
  assert.equal(b.events.filter(event => event.type === "error").length, 0);
  b.ask("next"); await drain();
  assert.equal(b.events.at(-1).type, "done");
});

await check("both canceled refresh waiters release slots; new requests reuse one refresh", async () => {
  const gate = deferred(); let refreshes = 0, requests = 0, refreshSignal;

  const b = backend(async (url, options) => {
    if (url.endsWith("/token")) { refreshes++; refreshSignal = options.signal;

 return gate.promise; }

    requests++;

 return response();
  });

  b.ask("a"); b.ask("b"); await drain();
  assert.throws(() => b.ask("blocked"), /still in progress/);
  b.cancel("a"); b.cancel("b"); await drain();
  assert.equal(refreshSignal.aborted, false);
  b.ask("c"); b.ask("d"); await drain();
  assert.equal(refreshes, 1);
  gate.resolve(tokens()); await drain();
  assert.equal(requests, 2);
  assert.deepEqual(b.events.map(e => `${e.id}:${e.type}`).sort(), ["a:done", "b:done", "c:done", "d:done"]);
  assert.equal(b.timers.size, 0);
});

await check("canceling one refresh waiter preserves the other's answer", async () => {
  const gate = deferred(); let refreshes = 0, requests = 0;

  const b = backend(async url => {
    if (url.endsWith("/token")) { refreshes++;

 return gate.promise; }

    requests++;

 return response(['data: {"type":"response.output_text.delta","delta":"answer"}\n\n', 'data: {"type":"response.completed"}\n\n']);
  });

  b.ask("a"); b.ask("b"); await drain(); b.cancel("a"); await drain();
  gate.resolve(tokens()); await drain();
  assert.equal(refreshes, 1); assert.equal(requests, 1);
  assert.equal(b.events.find(e => e.id === "b" && e.type === "delta")?.text, "answer");
  assert.equal(b.events.at(-1).type, "done");
});

for (const stage of ["fetch", "body"]) {
  await check(`refresh ${stage} timeout surfaces errors and frees slots for retry`, async () => {
    let stuck = true;

    const b = backend(async url => url.endsWith("/token") ? stuck
      ? stage === "fetch" ? new Promise(() => {}) : { text: () => new Promise(() => {}) }
      : tokens() : response());

    b.ask("a"); b.ask("b"); await b.tick(30_000);
    assert.equal(b.events.length, 2);
    assert.ok(b.events.every(e => e.type === "error" && e.code === "timeout" && /timed out/.test(e.message)));
    stuck = false; b.ask("c"); b.ask("d"); await drain();
    assert.equal(b.events.filter(e => e.type === "done").length, 2);
    assert.equal(b.timers.size, 0);
  });
}

for (const stage of ["fetch", "stream", "error-body"]) {
  await check(`ChatGPT ${stage} stall reports timeout, never done, and frees both slots`, async () => {
    let fetchSignal;

    const b = backend(async (_url, options) => {
      fetchSignal = options.signal;

      if (stage === "fetch") return new Promise(() => {});

      if (stage === "error-body") return { ok: false, status: 500, json: () => new Promise(() => {}) };

      return response(['data: {"type":"response.output_text.delta","delta":"partial"}\n\n'], true);
    }, false);

    b.ask("a"); b.ask("b"); await b.tick(60_000);
    assert.equal(fetchSignal.aborted, true);
    const ends = b.events.filter(e => e.type !== "delta");
    assert.equal(ends.length, 2); assert.ok(ends.every(e => e.type === "error" && e.code === "timeout"));
    assert.equal(b.timers.size, 0);
    b.ask("c"); b.ask("d"); b.cancel("c"); b.cancel("d"); await drain();
  });
}

await check("ongoing chunks cannot evade total response deadline", async () => {
  const reads = [];

  const b = backend(async () => ({ ok: true, status: 200, body: { getReader: () => ({
    read() { const gate = deferred(); reads.push(gate);

 return gate.promise; }, cancel: async () => {},
  }) } }), false);

  b.ask("a"); await drain();

  for (let i = 0; i < 5; i++) {
    await b.tick(50_000);
    reads.at(-1).resolve({ value: new TextEncoder().encode(': keepalive\n\n'), done: false }); await drain();
  }

  await b.tick(50_000);
  assert.equal(b.events.at(-1).type, "error"); assert.equal(b.events.at(-1).code, "timeout");
  assert.equal(b.timers.size, 0);
});

await check("explicit cancellation still reaches fetch and frees slots", async () => {
  const signals = [];

  const b = backend(async (_url, options) => { signals.push(options.signal);

 return new Promise(() => {}); }, false);

  b.ask("a"); b.ask("b"); await drain(); b.cancel("a"); b.cancel("b"); await drain();
  assert.equal(signals.length, 2); assert.ok(signals.every(s => s.aborted));
  assert.ok(b.events.every(e => e.type === "done")); assert.equal(b.timers.size, 0);
  b.ask("c"); b.ask("d"); b.cancel("c"); b.cancel("d"); await drain();
});

await check("401 refresh retry keeps fetch cancellation and shared refresh isolation", async () => {
  const gate = deferred(); const signals = []; let refreshSignal, requests = 0;

  const b = backend(async (url, options) => {
    if (url.endsWith("/token")) { refreshSignal = options.signal;

 return gate.promise; }

    signals.push(options.signal);

    if (++requests === 1) return { ok: false, status: 401, body: { cancel: async () => {} } };

    return response();
  }, false);

  b.ask("a"); await drain(); b.cancel("a"); await drain();
  assert.equal(signals[0].aborted, true); assert.equal(refreshSignal.aborted, false);
  gate.resolve(tokens()); await drain(); assert.equal(requests, 1);
  b.ask("b"); await drain(); assert.equal(b.events.at(-1).type, "done");
  assert.equal(requests, 2); assert.equal(b.timers.size, 0);
});

console.log(`${passed} AI lifecycle checks passed`);
