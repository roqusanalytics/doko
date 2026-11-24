// pdf_viewer.mjs reads the core library from globalThis.pdfjsLib at import time.
import * as pdfjsLib from "pdfjs-dist";

Object.assign(globalThis, { pdfjsLib });
