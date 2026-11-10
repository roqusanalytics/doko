import { stripTypeScriptTypes } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/pdfSecurity.ts", import.meta.url), "utf8");
const body = stripTypeScriptTypes(source.slice(source.indexOf("    const worker = new Worker("), source.indexOf("\n  });", source.indexOf("function securityWorker"))));
let worker, expire, clears = 0, failSend = false;
class FakeWorker {
  constructor() { worker = this; this.terminated = 0; }
  terminate() { this.terminated++; }
  postMessage() { if (failSend) throw new Error("clone failure"); }
}
const invoke = new Function("Worker", "signal", "bytes", "password", "setTimeout", "clearTimeout", "return new Promise((resolve,reject)=>{" + body.replace('new URL("./pdfSecurity.worker.ts", import.meta.url)', '"test-worker"') + "});");
const run = signal => invoke(FakeWorker, signal, new Uint8Array([1]), undefined, callback => { expire = callback; return 1; }, () => clears++);
for (const kind of ["send", "message", "crash", "timeout", "abort", "success"]) {
  const controller = new AbortController(); failSend = kind === "send";
  const pending = run(controller.signal);
  if (kind === "message") worker.onmessageerror({});
  if (kind === "crash") worker.onerror({});
  if (kind === "timeout") expire();
  if (kind === "abort") controller.abort();
  if (kind === "success") { worker.onmessage({data:{bytes:new Uint8Array([2])}}); assert.deepEqual(await pending,new Uint8Array([2])); }
  else await assert.rejects(pending);
  assert.equal(worker.terminated,1,kind); controller.abort(); assert.equal(worker.terminated,1,kind);
}
assert.equal(clears,6);
console.log("PASS PDF security worker: clone/message/native errors, timeout, abort and success dispose worker/listeners");
