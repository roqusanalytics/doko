/** Release notes from GitHub arrive as HTML (or a list per version); the UI shows short plain text. */
function releaseNotesText(notes) {
  const html = Array.isArray(notes) ? notes.map(n => n?.note ?? "").join("\n") : String(notes ?? "");
  // The release body ends with a generic "Download" section that says nothing about the changes.
  const body = html.split(/<h\d[^>]*>\s*Download\b|^#+\s*Download\b/im)[0];
  const text = body.replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return text.split("\n").map(line => line.trim()).filter(Boolean).join("\n").slice(0, 2000);
}

module.exports = { releaseNotesText };
