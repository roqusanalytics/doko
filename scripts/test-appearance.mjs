import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";

const server = await createServer({ root: path.resolve(import.meta.dirname, ".."), server: { middlewareMode: true }, appType: "custom" });
try {
  const { APPEARANCE_PRESETS, normalizeColor, appearanceColor, appearancePalette, luminance, surfaceTokens, migrateDefaultColors, DEFAULT_BACKGROUND, DEFAULT_WORK_AREA } = await server.ssrLoadModule("/src/appearance.ts");
  const saved = new Map();
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  for (const existing of [false, true]) {
    saved.clear();
    if (existing) { saved.set("folio:appearance", "ocean"); saved.set("folio:panel-color", "#ffffff"); }
    migrateDefaultColors();
    assert.equal(saved.get("folio:appearance"), "#76736f");
    assert.equal(saved.get("folio:panel-color"), "#202327");
    saved.set("folio:appearance", "sage");
    saved.set("folio:panel-color", "");
    migrateDefaultColors();
    assert.equal(saved.get("folio:appearance"), "sage", "migration must keep later background choices");
    assert.equal(saved.get("folio:panel-color"), "", "migration must keep Auto after restart or a new tab");
  }
  saved.clear();
  localStorage.setItem = () => { throw new Error("storage blocked"); };
  assert.doesNotThrow(migrateDefaultColors);
  assert.equal(saved.size, 0, "failed writes must not mark migration complete");
  saved.set("folio:appearance", "sage");
  saved.set("folio:panel-color", "");
  localStorage.setItem = (key, value) => {
    if (key === "folio:default-colors-v1") throw new Error("quota exceeded");
    saved.set(key, value);
  };
  migrateDefaultColors();
  migrateDefaultColors();
  assert.equal(saved.get("folio:appearance"), "sage", "marker failure must not overwrite saved choices");
  assert.equal(saved.get("folio:panel-color"), "", "marker failure must preserve Auto");
  delete globalThis.localStorage;
  assert.equal(APPEARANCE_PRESETS.length, 5);
  assert.equal(new Set(APPEARANCE_PRESETS.map(preset => preset.id)).size, 5);
  assert.equal(normalizeColor(" #AbC "), "#aabbcc");
  assert.equal(normalizeColor("#A1B2C3"), "#a1b2c3");
  for (const invalid of ["", "red", "#abcd", "#zzzzzz", "#ffffff00", "x".repeat(10000), "url(javascript:alert(1))"]) {
    assert.equal(normalizeColor(invalid), null);
    assert.equal(appearanceColor(invalid), null);
  }
  // A hover tint must change the color it sits on enough to be seen (luminance ratio of at least 1.08).
  const hoverVisible = (background, hover) => {
    const alpha = parseInt(hover.slice(7, 9), 16) / 255;
    const over = `#${[1, 3, 5].map(index => Math.round(parseInt(background.slice(index, index + 2), 16) * (1 - alpha) + parseInt(hover.slice(index, index + 2), 16) * alpha).toString(16).padStart(2, "0")).join("")}`;
    const a = luminance(background), b = luminance(over);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 1.08;
  };
  const colors = [DEFAULT_BACKGROUND, DEFAULT_WORK_AREA, ...APPEARANCE_PRESETS.map(preset => preset.color), "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#757575", "#767676", "#777777", "#ff00ff", "#ffff00"];
  for (const color of colors) for (const dark of [false, true]) {
    const palette = appearancePalette(color, dark);
    assert.equal(palette["--accent"], "#c5e1cb", "custom appearances must retain the Mint brand accent");
    assert.equal(palette["--accent-foreground"], "#1a1a1a", "Mint controls need dark foreground text");
    assert.notEqual(palette["--frame"], palette["--stage"], "the frame must differ from the work area");
    for (const surface of ["--bg", "--frame", "--stage", "--surface", "--surface-2"]) {
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
    for (const surface of ["--bg", "--frame", "--stage"]) assert.ok(hoverVisible(palette[surface], palette["--hover"]), `${color} ${dark}: hover is invisible on ${surface}`);
  }
  // Text on an exact frame or work-area color adapts: every text tone stays readable on that color and its surfaces.
  for (const color of [...colors, "#8ff5c0", "#1b1f24", "#2a2a2c", "#18181a", "#e2e0da", "#f4f3f0"]) {
    const tokens = surfaceTokens(color);
    for (const background of [color, tokens["--surface"], tokens["--surface-2"]]) for (const text of ["--text", "--text-2", "--text-3", "--accent-text"]) {
      const a = luminance(background), b = luminance(tokens[text]);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${color}: ${text} on ${background} lacks contrast`);
    }
    assert.ok(hoverVisible(color, tokens["--hover"]), `${color}: hover is invisible on the exact surface color`);
    assert.equal(tokens.color, "var(--text)");
    assert.equal(tokens["color-scheme"], luminance(color) > 0.179 ? "light" : "dark");
  }
  console.log("PASS appearance: 5 unique presets, hex validation, light/dark palettes, adaptive surface text and WCAG contrast including custom extremes");
} finally { await server.close(); }
