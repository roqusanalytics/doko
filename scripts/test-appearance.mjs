import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";

const server = await createServer({ root: path.resolve(import.meta.dirname, ".."), server: { middlewareMode: true }, appType: "custom" });
try {
  const { APPEARANCE_PRESETS, normalizeColor, appearanceColor, appearancePalette, luminance } = await server.ssrLoadModule("/src/appearance.ts");
  assert.equal(APPEARANCE_PRESETS.length, 10);
  assert.equal(new Set(APPEARANCE_PRESETS.map(preset => preset.id)).size, 10);
  assert.equal(normalizeColor(" #AbC "), "#aabbcc");
  assert.equal(normalizeColor("#A1B2C3"), "#a1b2c3");
  for (const invalid of ["", "red", "#abcd", "#zzzzzz", "#ffffff00", "x".repeat(10000), "url(javascript:alert(1))"]) {
    assert.equal(normalizeColor(invalid), null);
    assert.equal(appearanceColor(invalid), null);
  }
  const colors = [...APPEARANCE_PRESETS.map(preset => preset.color), "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#757575", "#767676", "#777777", "#ff00ff", "#ffff00"];
  for (const color of colors) for (const dark of [false, true]) {
    const palette = appearancePalette(color, dark);
    for (const surface of ["--bg", "--stage", "--surface", "--surface-2"]) {
      for (const text of ["--text", "--text-2", "--text-3", "--accent-text"]) {
        const a = luminance(palette[surface]), b = luminance(palette[text]);
        assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${color} ${dark} ${surface} ${text} lacks contrast`);
      }
    }
    for (const brightness of [1, 1.06]) {
      const bright = color => `#${[1, 3, 5].map(index => Math.min(255, Math.round(parseInt(color.slice(index, index + 2), 16) * brightness)).toString(16).padStart(2, "0")).join("")}`;
      const a = luminance(bright(palette["--accent"])), b = luminance(bright(palette["--accent-foreground"]));
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, "primary-button text lacks contrast");
    }
    if (!dark) assert.equal(palette["--bg"], color);
  }
  console.log("PASS appearance: 10 unique presets, hex validation, light/dark palettes and WCAG text contrast including custom extremes");
} finally { await server.close(); }
