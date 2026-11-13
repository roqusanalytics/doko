import { readSetting, writeSetting } from "./preferences";

export const WINDOW_TRANSPARENCY_KEY = "folio:window-transparency";
export const APPEARANCE_KEY = "folio:appearance";
export const DEFAULT_BACKGROUND = "#76736f";
export const DEFAULT_WORK_AREA = "#202327";
const DEFAULT_COLORS_KEY = "folio:default-colors-v1";

// Apply the new defaults once to existing profiles; later user choices remain theirs.
export function migrateDefaultColors() {
  if (readSetting(DEFAULT_COLORS_KEY) === "true") return;
  // Claim the migration first: a full store must not let later launches overwrite user choices.
  if (!writeSetting(DEFAULT_COLORS_KEY, "true")) return;
  writeSetting(APPEARANCE_KEY, DEFAULT_BACKGROUND);
  writeSetting("folio:panel-color", DEFAULT_WORK_AREA);
}
/** Optional exact color for the panels inside the app; empty follows the theme and palette; unset uses the default. The frame always follows the background. */
export const SURFACE_COLORS = [
  { key: "folio:panel-color", property: "--stage", label: "Work area",
    selector: ":is(.stage, .photo-carousel, .sidebar, .welcome, .ai-panel, .version-panel, .content-body, .document-tab.selected)" },
] as const;
export const APPEARANCE_PRESETS = [
  { id: "default", name: "Paper", color: "#f5f4f1" },
  { id: "sand", name: "Sand", color: "#f1e6d3" },
  { id: "sage", name: "Sage", color: "#e2eadf" },
  { id: "ocean", name: "Ocean", color: "#dceaf0" },
  { id: "slate", name: "Slate", color: "#dfe4ec" },
] as const;

export function normalizeColor(value: string): string | null {
  const color = value.trim();
  if (/^#[\da-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map(channel => channel + channel).join("")}`.toLowerCase();
  return /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

export function appearanceColor(value: string): string | null {
  return APPEARANCE_PRESETS.find(preset => preset.id === value)?.color ?? normalizeColor(value);
}

function mix(color: string, target: number, amount: number): string {
  return `#${[1, 3, 5].map(index => Math.round(parseInt(color.slice(index, index + 2), 16) * (1 - amount) + target * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function luminance(color: string): number {
  const channels = [1, 3, 5].map(index => {
    const channel = parseInt(color.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function appearancePalette(color: string, dark: boolean): Record<string, string> {
  const bg = dark ? mix(color, 0, 0.86) : color;
  const pale = luminance(bg) > 0.179;
  // Neutral surfaces keep controls and muted text readable even for saturated custom colors.
  const surface = mix(bg, pale ? 255 : 0, pale ? 0.86 : 0.3);
  const readable = (candidate: string) => {
    const light = Math.max(luminance(candidate), luminance(bg));
    const dark = Math.min(luminance(candidate), luminance(bg));
    return (light + 0.05) / (dark + 0.05) >= 4.5 ? candidate : pale ? "#000000" : "#ffffff";
  };
  // Panels move away from the text color, so they stand apart from the frame without losing contrast.
  const stage = mix(bg, pale ? 255 : 0, pale ? 0.55 : 0.35);
  return {
    "--appearance-scheme": pale ? "light" : "dark",
    // Pure white or black leaves no room for panels to move, so the frame steps toward the text instead.
    "--bg": bg, "--frame": stage === bg ? mix(bg, pale ? 0 : 255, 0.08) : bg, "--stage": stage,
    "--surface": surface, "--surface-2": mix(bg, pale ? 255 : 0, 0.75),
    "--text": pale ? "#000000" : "#ffffff", "--text-2": readable(pale ? "#383838" : "#ededed"),
    "--text-3": readable(pale ? "#494949" : "#dddddd"),
    "--line": pale ? "#00000020" : "#ffffff25", "--line-strong": pale ? "#00000040" : "#ffffff40",
    // Hover tints toward the text, so it shows on pale and dark colors alike; mid tones need a stronger tint.
    "--hover": pale ? (luminance(bg) > 0.5 ? "#2f5d3a1a" : "#2f5d3a33") : luminance(bg) < 0.03 ? "#c5e1cb24" : "#c5e1cb40",
    "--active": "color-mix(in srgb, var(--accent) 20%, var(--surface))",
    "--accent-text": readable(pale ? "#305d40" : "#c5e1cb"), "--accent": "#c5e1cb",
    "--accent-foreground": "#1a1a1a",
    "--accent-soft": "#c5e1cb3d",
  };
}

export function nativeAppearanceTheme(theme: string): string {
  const value = readSetting(APPEARANCE_KEY) || DEFAULT_BACKGROUND;
  const color = appearanceColor(value);
  return color && value !== "default" ? appearancePalette(color, !normalizeColor(value) && theme === "dark")["--appearance-scheme"] : theme;
}

const properties = Object.keys(appearancePalette("#ffffff", false));
export function applyAppearance(value = readSetting(APPEARANCE_KEY) || DEFAULT_BACKGROUND) {
  const color = appearanceColor(value);
  const root = document.documentElement;
  window.folioDesktop?.setTheme(nativeAppearanceTheme(root.dataset.theme || "light"));
  if (!color || value === "default") {
    properties.forEach(property => root.style.removeProperty(property));
    delete root.dataset.appearance;
  } else {
    root.dataset.appearance = value;
    const palette = appearancePalette(color, !normalizeColor(value) && root.dataset.theme === "dark");
    Object.entries(palette).forEach(([property, color]) => root.style.setProperty(property, color));
  }
  // An exact work-area color wins over the palette in both themes, and the text on them adapts.
  const rules: string[] = [];
  for (const { key, property, selector } of SURFACE_COLORS) {
    const custom = normalizeColor(readSetting(key) ?? DEFAULT_WORK_AREA);
    if (!custom) continue;
    root.style.setProperty(property, custom);
    rules.push(`${selector} { ${Object.entries(surfaceTokens(custom)).map(([name, token]) => `${name}: ${token};`).join(" ")} }`);
  }
  let style = document.getElementById("folio-surface-colors");
  if (!rules.length) return style?.remove();
  style ??= document.head.appendChild(Object.assign(document.createElement("style"), { id: "folio-surface-colors" }));
  style.textContent = rules.join("\n");
}

/** Readable text, lines and surfaces for content on an exact background color (from the contrast-checked palette). */
export function surfaceTokens(color: string): Record<string, string> {
  const palette = appearancePalette(color, false);
  const tokens: Record<string, string> = { "color-scheme": palette["--appearance-scheme"], color: "var(--text)" };
  for (const name of ["--surface", "--surface-2", "--text", "--text-2", "--text-3", "--line", "--line-strong", "--hover", "--active", "--accent-text"]) tokens[name] = palette[name];
  tokens["--glass"] = `color-mix(in srgb, ${palette["--surface"]} var(--glass-opacity, 88%), transparent)`;
  return tokens;
}

/** Saves an exact color for one surface, or clears it with null. Returns whether it was saved. */
export function saveSurfaceColor(key: string, value: string | null): boolean {
  const color = value === null ? "" : normalizeColor(value);
  if (color === null) return false;
  const saved = writeSetting(key, color);
  applyAppearance();
  return saved;
}

export function saveAppearance(value: string): boolean {
  if (!appearanceColor(value)) return false;
  const saved = writeSetting(APPEARANCE_KEY, value);
  applyAppearance(value);
  return saved;
}

function applyNativeMaterial(enabled: boolean) {
  document.documentElement?.toggleAttribute("data-window-material", enabled);
  document.querySelectorAll<HTMLIFrameElement>("iframe.document-reader").forEach(frame =>
    frame.contentDocument?.documentElement?.toggleAttribute("data-window-material", enabled));
}

export function applyWindowTransparency(enabled = readSetting(WINDOW_TRANSPARENCY_KEY) === "true") {
  document.documentElement.toggleAttribute("data-window-transparency", enabled);
  if (window.frameElement?.classList.contains("document-reader")) {
    document.documentElement.toggleAttribute("data-window-material", window.parent.document.documentElement.hasAttribute("data-window-material"));
  } else {
    void window.folioDesktop?.setWindowTransparency(enabled).then(applyNativeMaterial).catch(() => applyNativeMaterial(false));
  }
}

export function saveWindowTransparency(enabled: boolean): boolean {
  if (!writeSetting(WINDOW_TRANSPARENCY_KEY, String(enabled))) return false;
  applyWindowTransparency(enabled);
  return true;
}

export function initializeAppearance() {
  migrateDefaultColors();
  applyAppearance();
  applyWindowTransparency();
  if (!window.frameElement?.classList.contains("document-reader")) {
    const unsubscribe = window.folioDesktop?.onWindowTransparency(applyNativeMaterial);
    window.addEventListener("pagehide", () => unsubscribe?.(), { once: true });
  }
  window.addEventListener("storage", event => {
    if (event.key === "folio:theme" && (event.newValue === "light" || event.newValue === "dark")) document.documentElement.dataset.theme = event.newValue;
    if (event.key === WINDOW_TRANSPARENCY_KEY || event.key === null) applyWindowTransparency();
    if (event.key === APPEARANCE_KEY || SURFACE_COLORS.some(({ key }) => key === event.key) || event.key === null) applyAppearance();
  });
  // Existing reader theme controls also update their own React state and desktop chrome.
  new MutationObserver(() => applyAppearance()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
