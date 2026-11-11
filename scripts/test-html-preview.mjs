import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "parse5";
import { htmlPreview } from "../src/htmlPreview.ts";

const elements = node => [node, ...(node.childNodes ?? []).flatMap(elements), ...(node.content ? elements(node.content) : [])].filter(node => node.tagName);
const attr = (node, name) => node.attrs.find(attribute => attribute.name === name)?.value;

test("HTML keeps document styling and internal links but removes navigation and active resources", () => {
  const input = `<!doctype html><html lang="lt" dir="rtl" style="--ink:green"><head><style>body.report{color:var(--ink)}</style><base href="https://example.com"><meta http-equiv="refresh" content="0;url=https://example.com"></head><body class="report" style="background:black"><h1 id="start">Žinutė</h1><a href="#start">Top</a><a href="https://example.com">External</a><svg><a xlink:href="https://example.com">SVG</a><animate attributeName="href" to="https://example.com"/></svg><script>alert(1)</script><iframe src="https://example.com"></iframe><template><script>bad()</script><a href="https://example.com">Link</a></template></body></html>`;
  const output = htmlPreview(input), nodes = elements(parse(output));
  assert.equal(attr(nodes.find(node => node.tagName === "html"), "lang"), "lt");
  assert.equal(attr(nodes.find(node => node.tagName === "html"), "dir"), "rtl");
  assert.equal(attr(nodes.find(node => node.tagName === "body"), "class"), "report");
  assert.equal(attr(nodes.find(node => node.tagName === "body"), "style"), "background:black");
  assert.match(output, /body.report\{color:var\(--ink\)\}/);
  assert.equal(nodes.filter(node => ["script", "iframe", "base", "animate"].includes(node.tagName)).length, 0);
  const links = nodes.filter(node => node.tagName === "a");
  assert.deepEqual(links.map(node => attr(node, "href")), ["#start", undefined, undefined, undefined]);
  const policies = nodes.filter(node => node.tagName === "meta" && attr(node, "http-equiv"));
  assert.equal(policies.length, 1);
  assert.equal(attr(policies[0], "http-equiv"), "Content-Security-Policy");
  assert.match(attr(policies[0], "content"), /default-src 'none'/);
});

test("empty, malformed and long HTML can be previewed without a browser DOM", () => {
  for (const text of ["", "<h1>Unclosed", "<p>" + "Ž".repeat(500000)]) {
    const output = htmlPreview(text);
    assert.ok(output.includes("<head>")); assert.ok(output.includes("<body>"));
  }
});

test("noscript uses the same disabled-scripting parse mode as the preview sandbox", () => {
  const output = htmlPreview(`<head><noscript><meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com"><link rel="stylesheet" href="https://example.com"></noscript></head><body><noscript><a href="https://example.com">Visible without scripts</a><script>bad()</script></noscript></body>`);
  const nodes = elements(parse(output, { scriptingEnabled: false }));
  assert.equal(nodes.filter(node => ["script", "base", "link"].includes(node.tagName)).length, 0);
  assert.equal(nodes.filter(node => node.tagName === "meta" && attr(node, "http-equiv")?.toLowerCase() === "refresh").length, 0);
  assert.equal(attr(nodes.find(node => node.tagName === "a"), "href"), undefined);
});
