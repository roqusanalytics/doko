// Run after npm run build. Exercise the reader, IPC, and streaming with a fixture-only OpenRouter key.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
import { readerPage } from "./reader-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-markdown-ai-"));
const file = path.join(temp, "Launch plan.md");
const readOnlyFile = path.join(temp, "Read-only plan.md");
const plain = path.join(temp, "Notes.txt");
const before = "# Launch plan\n\nInvite two pilot teams.\n\n## Review\n\nCheck feedback on Friday.\n";
const after = before.replace("Invite two pilot teams.", "Invite three pilot teams.").replace("Check feedback on Friday.", "Review feedback on Thursday.");

writeFileSync(file, before);

writeFileSync(readOnlyFile, before);

chmodSync(readOnlyFile, 0o444);

writeFileSync(plain, before);

const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };

delete env.ELECTRON_RUN_AS_NODE;

let app;

try {
  app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio",
    ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
  const window = await app.firstWindow();
  window.setDefaultTimeout(10_000);
  await window.setViewportSize({ width: 1280, height: 800 });
  const page = readerPage(window);
  await page.getByRole("button", { name: "New canvas", exact: true }).click({ timeout: 30_000 });
  await page.locator("canvas.excalidraw__canvas.interactive").waitFor();
  const toolbar = () => page.locator(".topbar-right");
  const toggle = () => toolbar().getByRole("button", { name: "Ask AI", exact: true });

  const position = async locator => {
    await locator.waitFor();
    const box = await locator.boundingBox();
    assert.ok(box);

    return box;
  };

  const toolbarPositions = async () => ({
    ai: await position(toggle()),
    update: await position(toolbar().locator(".update-btn")),
  });

  const canvas = await toolbarPositions();
  await page.getByRole("tab", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Try a sample document" }).click();
  await page.locator(".page[data-page-number='1']").waitFor();
  const pdf = await toolbarPositions();

  await app.evaluate(({ net, safeStorage }) => {
    safeStorage.isAsyncEncryptionAvailable = async () => true;

    if (process.platform === "linux") safeStorage.getSelectedStorageBackend = () => "gnome_libsecret";
    safeStorage.encryptStringAsync = async value => Buffer.from(value);
    safeStorage.decryptStringAsync = async bytes => ({ result: Buffer.from(bytes).toString() });
    const originalFetch = net.fetch;
    const state = globalThis.markdownRouterTest = { requests: [], cancelled: false };
    net.fetch = async (url, options) => {
      if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch.call(net, url, options);

      if (options.headers.Authorization !== "Bearer fixture-only-markdown-key") return new Response(null, { status: 401 });
      const endpoint = new URL(url).pathname;

      if (endpoint === "/api/v1/key") return Response.json({ data: { label: "Test" } });

      if (endpoint === "/api/v1/models") return Response.json({ data: [
        { id: "sample/write", name: "Sample Write", context_length: 131072, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
      ] });

      if (endpoint !== "/api/v1/chat/completions") throw new Error("Unexpected OpenRouter endpoint");
      const request = JSON.parse(options.body);
      state.requests.push(request);
      const last = request.messages.at(-1).content;
      const question = last.startsWith("{") ? JSON.parse(last).question : last;
      const edit = (find, replacement) => "\n```doko-edit\n<<<<<<< FIND\n" + find + "\n=======\n" + replacement + "\n>>>>>>> REPLACE\n```";

      const responses = {
        "What is the plan?": ["Start with two pilot teams.", " Review their feedback on Friday."],
        "Update the launch plan": ["Increase the pilot to three teams and move the feedback review to Thursday.",
          edit("Invite two pilot teams.", "Invite three pilot teams.") + edit("Check feedback on Friday.", "Review feedback on Thursday.")],
        "Change the pilot count": ["Use four pilot teams.", edit("Invite two pilot teams.", "Invite four pilot teams.")],
        "Move the review": ["Move the review to Monday.", edit("Check feedback on Friday.", "Check feedback on Monday.")],
        "Stop this edit": ["Drafting a change.", edit("Invite two pilot teams.", "Invite five pilot teams.")],
      };

      const [first, second] = responses[question];
      const sse = value => new TextEncoder().encode("data: " + value + "\n\n");
      const part = value => sse(JSON.stringify({ choices: [{ delta: { content: value } }] }));

      return new Response(new ReadableStream({ start(controller) {
        const editStart = second.indexOf("```doko-edit");
        const boundary = editStart < 0 ? 0 : editStart + 15;
        controller.enqueue(part(first + second.slice(0, boundary)));
        state.finish = () => {
          controller.enqueue(part(second.slice(boundary)));
          controller.enqueue(sse("[DONE]"));
          controller.close();
        };

        options.signal.addEventListener("abort", () => {
          state.cancelled = true;

          try { controller.error(new Error("Stopped")); } catch {}
        }, { once: true });
      } }));
    };
  });

  // Use standard surfaces for the light and dark captures.
  await window.evaluate(() => {
    localStorage.setItem("folio:theme", "light");
    localStorage.setItem("folio:appearance", "default");
    localStorage.setItem("folio:panel-color", "");
  });
  const fileOpen = file => app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), file);
  const preview = () => page.getByLabel("Markdown preview", { exact: true });
  await fileOpen(file);
  await preview().getByRole("heading", { name: "Launch plan", exact: true }).waitFor();
  const markdown = await toolbarPositions();

  for (const [kind, boxes] of [["PDF", pdf], ["Canvas", canvas]]) {
    for (const control of ["ai", "update"]) {
      for (const field of ["x", "y", "width", "height"]) {
        assert.ok(Math.abs(markdown[control][field] - boxes[control][field]) <= 2,
          `${kind} ${control} button ${field} ${boxes[control][field]} differs from Markdown ${markdown[control][field]}`);
      }
    }
  }

  const trailing = await position(toolbar().getByRole("button", { name: "Use dark theme" }));
  assert.ok(trailing.x > markdown.ai.x);
  await toggle().click();
  assert.deepEqual(await toolbarPositions(), markdown, "Opening the panel moved the toolbar buttons");
  const panel = page.getByRole("complementary", { name: "Ask AI" });
  await panel.getByRole("button", { name: "AI provider", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "OpenRouter", exact: true }).click();
  await panel.getByRole("button", { name: "Open Ask AI settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByLabel("API key", { exact: true }).fill("fixture-only-markdown-key");
  await settings.getByRole("button", { name: "Verify and save" }).click();
  await settings.getByRole("button", { name: /Sample Write/ }).click();
  await settings.getByRole("button", { name: "Close", exact: true }).click();

  const send = async question => {
    await panel.getByRole("textbox").fill(question);
    await panel.getByRole("button", { name: "Send", exact: true }).click();
  };

  const finish = () => app.evaluate(() => globalThis.markdownRouterTest.finish());
  const apply = panel.getByRole("button", { name: "Apply", exact: true });
  const discard = panel.getByRole("button", { name: "Discard", exact: true });
  const dirty = page.getByRole("img", { name: "Unsaved changes" }).first();
  const useSource = page.getByRole("button", { name: "View source", exact: true });
  const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
  const undo = process.platform === "darwin" ? "Meta+z" : "Control+z";

  const selected = "Invite two pilot teams.";
  await preview().getByText(selected, { exact: true }).evaluate(element => {
    const selection = window.getSelection();
    selection.selectAllChildren(element);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await panel.locator(".context-chip").getByText(/Invite two pilot teams/).waitFor();
  await send("What is the plan?");
  await panel.getByText("Start with two pilot teams.", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Stop", exact: true }).waitFor();
  const request = await app.evaluate(() => globalThis.markdownRouterTest.requests[0]);
  assert.match(request.messages[0].content, /untrusted reference data/);
  assert.match(request.messages[0].content, /doko-edit/);
  assert.deepEqual(JSON.parse(request.messages[1].content).document, { kind: "markdown", name: "Launch plan.md", text: before, truncated: false });
  assert.deepEqual(JSON.parse(request.messages.at(-1).content).selectedPassage, { text: selected });
  await finish();
  await panel.getByText("Start with two pilot teams. Review their feedback on Friday.", { exact: true }).waitFor();
  console.log("ok  same Ask AI button position as PDF and Canvas, streamed question with full source and View selection");

  await send("Update the launch plan");
  await panel.getByText(/Increase the pilot to three teams/).waitFor();
  assert.equal(await apply.count(), 0);
  assert.doesNotMatch(await panel.innerText(), /doko-edit|<<<<<<< FIND/);
  assert.equal(await page.locator(".cm-editor").count(), 0);
  assert.equal(await dirty.count(), 0);
  await finish();
  await apply.waitFor();
  assert.equal(await panel.locator(".markdown-diff").count(), 2);
  assert.match(await panel.locator(".markdown-diff").first().innerText(), /−Invite two pilot teams\.\s*\+Invite three pilot teams\./);

  const contrast = () => panel.locator(".markdown-diff-line").evaluateAll(rows => rows.map(row => {
    const luminance = color => {
      const values = color.match(/[\d.]+/g).slice(0, 3).map(n => Number(n) / 255);
      const linear = values.map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);

      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    };

    const style = getComputedStyle(row);
    const a = luminance(style.color), b = luminance(style.backgroundColor);

    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  }));

  const capture = async theme => {
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    assert.ok((await contrast()).every(ratio => ratio >= 4.5), `Diff contrast below AA in ${theme}`);
    const shots = process.env.DOKO_MARKDOWN_AI_SCREENSHOTS;

    if (shots) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, `markdown-ai-${theme}.png`), animations: "disabled" });
    }
  };

  await capture("light");
  await toolbar().getByRole("button", { name: "Use dark theme" }).click();
  await capture("dark");

  for (const [color, scheme] of [["#e4cfff", "light"], ["#51427a", "dark"]]) {
    // Write from the shell so the document iframe receives the same preference event as on a settings change.
    await window.evaluate(color => localStorage.setItem("folio:panel-color", color), color);
    await page.waitForFunction(scheme => getComputedStyle(document.querySelector(".ai-panel")).colorScheme === scheme, scheme);
    assert.ok((await contrast()).every(ratio => ratio >= 4.5), `Diff contrast below AA on ${color}`);
  }

  await apply.click();
  await panel.getByText("Edits applied", { exact: true }).waitFor();
  await preview().getByText("Invite three pilot teams.", { exact: true }).waitFor();
  await preview().getByText("Review feedback on Thursday.", { exact: true }).waitFor();
  await preview().locator(".markdown-edit-highlight").getByText("Invite three pilot teams.", { exact: true }).waitFor();
  await dirty.waitFor();
  assert.equal(readFileSync(file, "utf8"), before, "Apply wrote the file before Save");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("All changes saved", { exact: true }).waitFor();
  assert.equal(readFileSync(file, "utf8"), after);
  await useSource.click();
  await source.waitFor();
  await source.click();
  await page.keyboard.press(undo);
  await source.getByText(selected, { exact: true }).waitFor();
  await source.getByText("Check feedback on Friday.", { exact: true }).waitFor();
  await dirty.waitFor();
  console.log("ok  validated diff, AA contrast in both themes, Apply in View, highlight, dirty state, Save, and one Undo after opening Source");

  await source.getByText(selected, { exact: true }).dblclick();
  await panel.locator(".context-chip").waitFor();
  await send("Move the review");
  await panel.getByText("Move the review to Monday.", { exact: true }).waitFor();
  const sourceRequest = await app.evaluate(() => globalThis.markdownRouterTest.requests.at(-1));
  assert.ok(selected.includes(JSON.parse(sourceRequest.messages.at(-1).content).selectedPassage.text));
  await finish();
  await apply.click();
  await source.locator(".markdown-edit-highlight").getByText("Check feedback on Monday.", { exact: true }).waitFor();
  await page.keyboard.press(undo);
  await source.getByText("Check feedback on Friday.", { exact: true }).waitFor();

  await send("Change the pilot count");
  await panel.getByText("Use four pilot teams.", { exact: true }).waitFor();
  await finish();
  await apply.waitFor();
  await source.getByText(selected, { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.insertText("Welcome the pilot teams.");
  const stale = await source.innerText();
  assert.doesNotMatch(stale, /Invite two pilot teams/);
  await apply.click();
  await panel.getByRole("alert").getByText("The document changed since this suggestion. Ask again.", { exact: true }).waitFor();
  assert.equal(await source.innerText(), stale);
  await discard.click();
  await panel.getByText("Edits discarded", { exact: true }).waitFor();
  assert.equal(await source.innerText(), stale);
  assert.equal(await panel.locator(".markdown-diff").count(), 0);
  await send("Stop this edit");
  await panel.getByText("Drafting a change.", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await panel.getByText("Drafting a change.", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await source.innerText(), stale);
  await toggle().click();
  await panel.waitFor({ state: "hidden" });
  await toggle().click();
  await panel.getByText("Edits discarded", { exact: true }).waitFor();
  assert.equal(await panel.getByText("Edits applied", { exact: true }).count(), 2);
  console.log("ok  Source selection, apply, highlight, Undo, stale rejection, Discard, Stop, and history");

  await page.getByRole("button", { name: "Close Launch plan.md, unsaved changes", exact: true }).click();
  await page.getByRole("dialog", { name: "Unsaved changes" }).getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("tab", { name: "Launch plan.md", exact: true }).waitFor({ state: "hidden" });
  await fileOpen(file);
  await preview().getByText("Invite three pilot teams.", { exact: true }).waitFor();
  await toggle().click();
  await panel.getByText("Edits discarded", { exact: true }).waitFor();
  assert.equal(await panel.getByText("Edits applied", { exact: true }).count(), 2);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
  await settings.getByRole("button", { name: "Storage", exact: true }).click();
  const stored = settings.locator(".stored-data");
  await stored.locator("summary").click();
  await stored.getByRole("button", { name: "Clear chats…", exact: true }).click();
  await stored.getByRole("alertdialog").getByRole("button", { name: "Clear chats", exact: true }).click();
  await stored.getByRole("alertdialog").waitFor({ state: "detached" });
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "Launch plan.md", exact: true }).click();
  await panel.waitFor();
  assert.equal(await panel.getByText("Edits discarded", { exact: true }).count(), 0, "a cleared chat came back in the Markdown reader");
  assert.equal(await panel.getByText("Edits applied", { exact: true }).count(), 0, "a cleared chat came back in the Markdown reader");
  console.log("ok  Settings → Clear chats removes the Markdown reader's Ask AI chat");

  await fileOpen(readOnlyFile);
  await preview().getByRole("heading", { name: "Launch plan", exact: true }).waitFor();
  await toggle().click();
  await send("Move the review");
  await panel.getByText("Move the review to Monday.", { exact: true }).waitFor();
  await finish();
  await panel.getByText("This document is read-only.", { exact: true }).waitFor();
  assert.ok(await apply.isDisabled());

  await fileOpen(plain);
  await page.getByRole("textbox", { name: "Text document", exact: true }).waitFor();
  assert.equal(await toggle().count(), 0);
  await assertHidden(app);
  console.log("PASS Markdown Ask AI including read-only preview and the plain text exclusion");
} finally {
  try { if (app) await closeHidden(app); }
  finally {
    chmodSync(readOnlyFile, 0o644);
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
