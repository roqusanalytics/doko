import { cpSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "public/excalidraw/fonts");

rmSync(target, { recursive: true, force: true });

// shortcut: Xiaolai (CJK fallback, ~12 MB) is not shipped, so CJK text on a Canvas uses a system font; ship it if CJK handwriting is needed.
cpSync(resolve(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts"), target,
  { recursive: true, filter: source => basename(source) !== "Xiaolai" });
