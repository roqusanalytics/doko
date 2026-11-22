import { cpSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
cpSync(resolve(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts"),
  resolve(root, "public/excalidraw/fonts"), { recursive: true });
