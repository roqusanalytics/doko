const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseNotesText } = require("../electron/release-notes.cjs");

test("release notes become short plain text without the download section", () => {
  assert.equal(releaseNotesText("<p>Panels &amp; tabs</p>\n<h2>Download</h2><ul><li>Windows</li></ul>"), "Panels & tabs");
  assert.equal(releaseNotesText("Fixes\n\n## Download\n- macOS"), "Fixes");
  assert.equal(releaseNotesText([{ note: "<p>A</p>" }, { note: "<li>B &lt;c&gt;</li>" }]), "A\nB <c>");
  assert.equal(releaseNotesText("<script>alert(1)</script>Safe"), "alert(1)Safe");
});

test("missing or huge notes stay bounded", () => {
  assert.equal(releaseNotesText(null), "");
  assert.equal(releaseNotesText(undefined), "");
  assert.equal(releaseNotesText("x".repeat(5000)).length, 2000);
});
