import assert from "node:assert/strict";
import { test } from "node:test";
import { readerPage } from "./reader-page.mjs";

function fixture(outcomes, operation = async () => "ready") {
  const calls = { acquired: 0, disposed: 0, operations: 0 };
  const run = async (...args) => { calls.operations++; return operation(...args); };
  const owner = { evaluate: run, waitForFunction: run };
  const reader = {
    locator: () => ({ elementHandle: async () => {
      const outcome = outcomes[calls.acquired++];
      return {
        ownerFrame: async () => {
          if (outcome instanceof Error) throw outcome;
          return outcome === null ? null : owner;
        },
        dispose: async () => { calls.disposed++; },
      };
    } }),
    getByRole() {}, getByLabel() {}, getByTitle() {}, getByText() {},
  };
  const window = {
    frameLocator: () => reader,
    on() {}, reload() {}, title() {}, screenshot() {}, waitForTimeout() {}, waitForEvent() {},
  };
  return { page: readerPage(window), calls };
}

test("reacquires a frame detached before dispatch and disposes every handle", async () => {
  const { page, calls } = fixture([new Error("elementHandle.ownerFrame: Frame was detached"), true]);
  assert.equal(await page.evaluate(() => {}), "ready");
  assert.deepEqual(calls, { acquired: 2, disposed: 2, operations: 1 });
});

test("reacquires a null owner frame", async () => {
  const { page, calls } = fixture([null, true]);
  assert.equal(await page.waitForFunction(() => true), "ready");
  assert.deepEqual(calls, { acquired: 2, disposed: 2, operations: 1 });
});

for (const outcome of [null, new Error("elementHandle.ownerFrame: Frame was detached")]) {
  test(`stops after three ${outcome === null ? "null" : "detached"} owner frames`, async () => {
    const { page, calls } = fixture([outcome, outcome, outcome]);
    await assert.rejects(page.evaluate(() => {}), /frame was detached/i);
    assert.deepEqual(calls, { acquired: 3, disposed: 3, operations: 0 });
  });
}

test("propagates unrelated acquisition errors without retry", async () => {
  const error = new Error("Target closed");
  const { page, calls } = fixture([error]);
  await assert.rejects(page.evaluate(() => {}), caught => caught === error);
  assert.deepEqual(calls, { acquired: 1, disposed: 1, operations: 0 });
});

for (const method of ["evaluate", "waitForFunction"]) {
  test(`${method} never repeats an operation after dispatch`, async () => {
    const error = new Error("Frame was detached");
    let sideEffects = 0;
    const { page, calls } = fixture([true], async callback => { callback(); throw error; });
    await assert.rejects(page[method](() => { sideEffects++; }), caught => caught === error);
    assert.equal(sideEffects, 1);
    assert.deepEqual(calls, { acquired: 1, disposed: 1, operations: 1 });
  });
}
