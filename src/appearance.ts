import { readSetting, writeSetting } from "./preferences";

export const APPEARANCE_KEY = "folio:appearance";
export const APPEARANCE_PRESETS = [
  { id: "default", name: "Paper", color: "#f5f4f1" },
  { id: "sand", name: "Sand", color: "#f1e6d3" },
  { id: "sage", name: "Sage", color: "#e2eadf" },
  { id: "ocean", name: "Ocean", color: "#dceaf0" },
  { id: "lavender", name: "Lavender", color: "#e9e2f1" },
  { id: "rose", name: "Rose", color: "#f2e1e4" },
  { id: "clay", name: "Clay", color: "#eddccd" },
  { id: "mint", name: "Mint", color: "#dceee7" },
  { id: "slate", name: "Slate", color: "#dfe4ec" },
  { id: "butter", name: "Butter", color: "#f4edce" },
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
  return {
    "--appearance-scheme": pale ? "light" : "dark",
    "--bg": bg, "--stage": mix(bg, pale ? 255 : 0, 0.06),
    "--surface": surface, "--surface-2": mix(bg, pale ? 255 : 0, 0.75),
    "--text": pale ? "#000000" : "#ffffff", "--text-2": readable(pale ? "#383838" : "#ededed"),
    "--text-3": readable(pale ? "#494949" : "#dddddd"),
    "--line": pale ? "#00000020" : "#ffffff25", "--line-strong": pale ? "#00000040" : "#ffffff40",
    "--hover": pale ? "#0000000e" : "#ffffff14", "--active": pale ? "#00000018" : "#ffffff20",
    "--accent-text": readable(pale ? "#942c1c" : "#ffad9e"), "--accent": pale ? "#b53724" : "#f0664f",
    "--accent-foreground": pale ? "#ffffff" : "#000000",
    "--accent-soft": pale ? "#942c1c14" : "#ffad9e20",
  };
}

const properties = Object.keys(appearancePalette("#ffffff", false));
export function applyAppearance(value = readSetting(APPEARANCE_KEY) || "default") {
  const color = appearanceColor(value);
  const root = document.documentElement;
  if (!color || value === "default") {
    properties.forEach(property => root.style.removeProperty(property));
    delete root.dataset.appearance;
    return;
  }
  root.dataset.appearance = value;
  const palette = appearancePalette(color, !normalizeColor(value) && root.dataset.theme === "dark");
  Object.entries(palette).forEach(([property, color]) => root.style.setProperty(property, color));
}

export function saveAppearance(value: string): boolean {
  if (!appearanceColor(value)) return false;
  const saved = writeSetting(APPEARANCE_KEY, value);
  applyAppearance(value);
  return saved;
}

export function initializeAppearance() {
  applyAppearance();
  window.addEventListener("storage", event => {
    if (event.key === "folio:theme" && (event.newValue === "light" || event.newValue === "dark")) document.documentElement.dataset.theme = event.newValue;
    if (event.key === APPEARANCE_KEY || event.key === null) applyAppearance();
  });
  // Existing reader theme controls also update their own React state and desktop chrome.
  new MutationObserver(() => applyAppearance()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
