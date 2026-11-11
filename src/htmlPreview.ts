import { parse, parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";

const POLICY = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
const BLOCKED = new Set(["script", "meta", "base", "link", "iframe", "frame", "frameset", "object", "embed", "animate", "set", "animateMotion", "animateTransform"]);

export function htmlPreview(text: string): string {
  // Parse without a browser DOM so even malicious image/frame URLs cannot make requests during parsing.
  const doc = parse(text, { scriptingEnabled: false });
  const clean = (node: DefaultTreeAdapterTypes.ParentNode) => {
    node.childNodes = node.childNodes.filter(child => !("tagName" in child) || !BLOCKED.has(child.tagName));
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      child.attrs = child.attrs.filter(attribute => attribute.name !== "href" || attribute.value.startsWith("#"));
      clean(child);
      if ("content" in child) clean(child.content as DefaultTreeAdapterTypes.DocumentFragment);
      if (child.tagName === "head") {
        const policy = parseFragment(`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><meta name="viewport" content="width=device-width, initial-scale=1">`);
        for (const meta of policy.childNodes) meta.parentNode = child;
        child.childNodes.unshift(...policy.childNodes);
      }
    }
  };
  clean(doc);
  return serialize(doc);
}
