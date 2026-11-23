const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const isImage = file => isObject(file) && typeof file.dataURL === "string"
  && /^data:image\/[\w.+-]+;base64,/i.test(file.dataURL);

function validateCanvasDocument(text) {
  let scene;

  try { scene = JSON.parse(text); }
  catch { throw new Error("This Excalidraw file contains invalid JSON."); }

  if (scene?.type !== "excalidraw") throw new Error("This isn't an Excalidraw drawing.");

  // The internal iframe type can carry generated HTML. Doko only opens drawing data.
  if (!Array.isArray(scene.elements) || scene.elements.some(element =>
    !isObject(element) || typeof element.type !== "string" || element.type === "iframe") ||
    (scene.appState != null && !isObject(scene.appState)) ||
    (scene.files != null && (!isObject(scene.files) || !Object.values(scene.files).every(isImage)))) {
    throw new Error("This Excalidraw file contains invalid or unsupported drawing data.");
  }
}

function decodeCanvasDocument(data) {
  let text;

  try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { throw new Error("Excalidraw files must be saved as UTF-8 text."); }

  validateCanvasDocument(text);
  const bom = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;

  return { text, bom, eol: text.match(/\r\n|\n|\r/)?.[0] ?? "\n", encoding: "utf-8" };
}

module.exports = { decodeCanvasDocument, validateCanvasDocument };
