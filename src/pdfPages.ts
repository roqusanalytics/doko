import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFNull, PDFObjectCopier, PDFPage, PDFPageLeaf, PDFRef, PDFStream, PDFString, degrees, type PDFObject } from "pdf-lib";
import { checkPageCount, checkPdfSize } from "./pdfInput";

export type PdfPageChange =
  | { type: "insert"; index: number; bytes: Uint8Array }
  | { type: "blank"; index: number; matchPage: number }
  | { type: "delete"; pages: number[] }
  | { type: "rotate"; pages: number[] };

const key = PDFName.of;
const named = (value: PDFObject | undefined) => value instanceof PDFName || value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
const dict = (pdf: PDFDocument, value: PDFObject | undefined) => { const resolved = pdf.context.lookup(value); return resolved instanceof PDFDict ? resolved : undefined; };

async function read(bytes: Uint8Array) {
  checkPdfSize(bytes.byteLength);
  if (!bytes.byteLength) throw new Error("The PDF is empty.");
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-")) throw new Error("Choose a valid PDF file.");
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); pdf.getPageCount(); }
  catch (error) {
    if (/encrypt/i.test(String(error))) throw new Error("Encrypted PDFs cannot be changed here. Your original stays protected.");
    throw new Error("This PDF could not be read. It may be damaged.");
  }
  checkPageCount(pdf.getPageCount());
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && (object.has(key("ByteRange")) || named(object.get(key("Type"))) === "Sig" || named(object.get(key("FT"))) === "Sig")) {
      throw new Error("PDFs with digital signatures or signature fields cannot be changed here.");
    }
  }
  if (pdf.catalog.has(key("Perms"))) throw new Error("This PDF has certification permissions and cannot be changed here.");
  const form = dict(pdf, pdf.catalog.get(key("AcroForm")));
  if (form?.has(key("XFA"))) throw new Error("XFA forms cannot be changed here.");
  return pdf;
}

/** Validate before opening the editor, without rewriting the source. */
export async function inspectPdfPages(bytes: Uint8Array) { return (await read(bytes)).getPageCount(); }

function checkStructure(pdf: PDFDocument) {
  // shortcut: these structures use page indices or document-wide references; support them before allowing structural edits.
  if (["PageLabels", "Threads"].some(name => pdf.catalog.has(key(name)))) {
    throw new Error("This PDF has custom page labels or article threads that page changes cannot preserve yet.");
  }
}

function prepareImportedPages(source: PDFDocument) {
  const destinations = new Map<string, PDFObject>();
  const legacy = dict(source, source.catalog.get(key("Dests")));
  for (const [name, target] of legacy?.entries() ?? []) destinations.set(name.decodeText(), target);
  const nameNodes = new Set<PDFDict>();
  const readNames = (node: PDFDict) => {
    if (nameNodes.has(node)) throw new Error("The inserted PDF has a damaged destination tree.");
    nameNodes.add(node);
    const entries = node.lookupMaybe(key("Names"), PDFArray);
    if (entries) for (let index = 0; index + 1 < entries.size(); index += 2) {
      const name = named(entries.get(index)); if (name !== null) destinations.set(name, entries.get(index + 1));
    }
    for (const child of node.lookupMaybe(key("Kids"), PDFArray)?.asArray() ?? []) { const node = dict(source, child); if (node) readNames(node); }
  };
  const names = dict(source, source.catalog.get(key("Names")));
  const tree = dict(source, names?.get(key("Dests")));
  if (tree) readNames(tree);
  const pages = source.getPages();
  const pageRefs = new Set(pages.map(page => String(page.ref)));
  const resolveDestination = (value: PDFObject | undefined): PDFArray => {
    const visited = new Set<PDFObject>();
    while (value && !visited.has(value)) {
      visited.add(value);
      const name = named(value);
      if (name !== null) { value = destinations.get(name); continue; }
      const object = source.context.lookup(value);
      if (object instanceof PDFDict) { value = object.get(key("D")); continue; }
      if (object instanceof PDFArray) {
        const first = object.get(0);
        if (first instanceof PDFNumber && Number.isSafeInteger(first.asNumber()) && first.asNumber() >= 0 && first.asNumber() < pages.length) object.set(0, pages[first.asNumber()].ref);
        if (pageRefs.has(String(object.get(0)))) return object;
      }
      break;
    }
    throw new Error("The inserted PDF has an unresolved internal page link. No pages were changed.");
  };
  const visited = new Set<PDFObject>();
  const visit = (value: PDFObject | undefined) => {
    const object = source.context.lookup(value);
    if (!object || visited.has(object)) return;
    visited.add(object);
    if (object instanceof PDFDict) {
      if (named(object.get(key("Subtype"))) === "Widget") throw new Error("Inserting PDFs with form fields is not supported yet. No pages were changed.");
      // Page-local tag indices refer to the source catalog's structure tree, which is not imported.
      object.delete(key("StructParents")); object.delete(key("StructParent"));
      const destination = object.get(key("Dest"));
      if (destination) object.set(key("Dest"), resolveDestination(destination));
      if (named(object.get(key("S"))) === "GoTo") object.set(key("D"), resolveDestination(object.get(key("D"))));
      for (const [, child] of object.entries()) visit(child);
    } else if (object instanceof PDFArray) for (const child of object.asArray()) visit(child);
    else if (object instanceof PDFStream) visit(object.dict);
  };
  for (const page of pages) visit(page.node);
  return pages;
}

function pruneTags(pdf: PDFDocument, deleted: Set<string>) {
  const root = dict(pdf, pdf.catalog.get(key("StructTreeRoot")));
  if (!root) return;
  const removedObjects = new Set<string>();
  const removedParents = new Set<number>();
  for (const page of pdf.getPages()) if (deleted.has(String(page.ref))) {
    const parent = page.node.lookupMaybe(key("StructParents"), PDFNumber);
    if (parent) removedParents.add(parent.asNumber());
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      removedObjects.add(String(ref));
      const parent = dict(pdf, ref)?.lookupMaybe(key("StructParent"), PDFNumber);
      if (parent) removedParents.add(parent.asNumber());
    }
  }
  const visited = new Set<PDFDict>();
  const prune = (value: PDFObject | undefined, inheritedPage?: PDFObject): PDFObject | undefined => {
    const object = pdf.context.lookup(value);
    if (object instanceof PDFArray) {
      for (let index = object.size() - 1; index >= 0; index--) {
        const kept = prune(object.get(index), inheritedPage);
        if (kept) object.set(index, kept); else object.remove(index);
      }
      return object.size() ? value : undefined;
    }
    if (object instanceof PDFNumber) return deleted.has(String(inheritedPage)) ? undefined : value;
    if (!(object instanceof PDFDict)) return value;
    if (visited.has(object)) throw new Error("This PDF has a damaged tag structure.");
    visited.add(object);
    const page = object.get(key("Pg")) ?? inheritedPage;
    const type = named(object.get(key("Type")));
    const content = type === "MCR" || type === "OBJR";
    const children = object.get(key("K"));
    const kept = children ? prune(children, page) : undefined;
    const remove = content ? deleted.has(String(page)) || removedObjects.has(String(object.get(key("Obj")))) : children ? !kept : deleted.has(String(page));
    if (remove) { if (value instanceof PDFRef) removedObjects.add(String(value)); return undefined; }
    if (children && kept) object.set(key("K"), kept);
    if (deleted.has(String(object.get(key("Pg"))))) object.delete(key("Pg"));
    return value;
  };
  const children = prune(root.get(key("K")));
  if (children) root.set(key("K"), children); else root.delete(key("K"));
  const treeNodes = new Set<PDFDict>();
  const pruneTree = (node: PDFDict, entriesKey: "Nums" | "Names"): PDFObject[] => {
    if (treeNodes.has(node)) throw new Error("This PDF has a damaged tag lookup tree.");
    treeNodes.add(node);
    const entries = node.lookupMaybe(key(entriesKey), PDFArray);
    if (entries) for (let index = entries.size() - 2; index >= 0; index -= 2) {
      const name = entries.get(index), target = entries.get(index + 1);
      if ((name instanceof PDFNumber && removedParents.has(name.asNumber())) || removedObjects.has(String(target))) { entries.remove(index + 1); entries.remove(index); continue; }
      const array = pdf.context.lookup(target);
      if (array instanceof PDFArray) for (let position = 0; position < array.size(); position++) if (removedObjects.has(String(array.get(position)))) array.set(position, PDFNull);
    }
    const kids = node.lookupMaybe(key("Kids"), PDFArray);
    const limits: PDFObject[] = [];
    if (kids) for (let index = 0; index < kids.size();) {
      const child = dict(pdf, kids.get(index));
      const range = child ? pruneTree(child, entriesKey) : [];
      if (!range.length) kids.remove(index); else { limits.push(...range); index++; }
    }
    if (entries?.size()) limits.push(entries.get(0), entries.get(entries.size() - 2));
    const range = limits.length ? [limits[0], limits.at(-1)!] : [];
    if (range.length) node.set(key("Limits"), pdf.context.obj(range)); else node.delete(key("Limits"));
    return range;
  };
  for (const [name, entries] of [["ParentTree", "Nums"], ["IDTree", "Names"]] as const) {
    const tree = dict(pdf, root.get(key(name)));
    if (tree && !pruneTree(tree, entries).length) root.delete(key(name));
  }
  for (const [, object] of pdf.context.enumerateIndirectObjects()) if (object instanceof PDFDict && named(object.get(key("Type"))) === "StructElem") {
    const references = object.lookupMaybe(key("Ref"), PDFArray);
    if (references) for (let index = references.size() - 1; index >= 0; index--) if (removedObjects.has(String(references.get(index)))) references.remove(index);
  }
}

function pruneDeletedPages(pdf: PDFDocument, deleted: Set<string>, widgets: Set<string>) {
  const removedNames = new Set<string>();
  const deadDestination = (value: PDFObject | undefined): boolean => {
    const name = named(value);
    if (name !== null) return removedNames.has(name);
    const resolved = pdf.context.lookup(value);
    if (resolved instanceof PDFArray) return deleted.has(String(resolved.get(0)));
    if (resolved instanceof PDFDict) return deadDestination(resolved.get(key("D")));
    return false;
  };
  const destinations = dict(pdf, pdf.catalog.get(key("Dests")));
  for (const [name, destination] of destinations?.entries() ?? []) {
    if (deadDestination(destination)) { removedNames.add(name.decodeText()); destinations!.delete(name); }
  }
  const names = dict(pdf, pdf.catalog.get(key("Names")));
  const nameNodes = new Set<PDFDict>();
  const pruneNames = (node: PDFDict): PDFObject[] => {
    if (nameNodes.has(node)) throw new Error("This PDF has a damaged destination tree.");
    nameNodes.add(node);
    const pairs = node.lookupMaybe(key("Names"), PDFArray);
    if (pairs) for (let index = pairs.size() - 2; index >= 0; index -= 2) {
      if (deadDestination(pairs.get(index + 1))) { const name = named(pairs.get(index)); if (name !== null) removedNames.add(name); pairs.remove(index + 1); pairs.remove(index); }
    }
    const kids = node.lookupMaybe(key("Kids"), PDFArray);
    const limits: PDFObject[] = [];
    if (kids) for (let index = 0; index < kids.size();) {
      const child = dict(pdf, kids.get(index));
      const range = child ? pruneNames(child) : [];
      if (!range.length) kids.remove(index); else { limits.push(...range); index++; }
    }
    if (pairs?.size()) limits.push(pairs.get(0), pairs.get(pairs.size() - 2));
    const range = limits.length ? [limits[0], limits.at(-1)!] : [];
    if (range.length) node.set(key("Limits"), pdf.context.obj(range)); else node.delete(key("Limits"));
    return range;
  };
  const destinationTree = dict(pdf, names?.get(key("Dests")));
  if (destinationTree && !pruneNames(destinationTree).length) names!.delete(key("Dests"));
  const activeActions = new Set<PDFDict>();
  const actionResults = new Map<PDFDict, PDFObject | undefined>();
  const pruneAction = (value: PDFObject | undefined): PDFObject | undefined => {
    const action = pdf.context.lookup(value);
    if (action instanceof PDFArray) {
      for (let index = action.size() - 1; index >= 0; index--) {
        const kept = pruneAction(action.get(index));
        if (kept) action.set(index, kept); else action.remove(index);
      }
      return action.size() ? value : undefined;
    }
    if (!(action instanceof PDFDict)) return value;
    if (activeActions.has(action)) throw new Error("This PDF has a cyclic action chain that cannot be changed safely.");
    if (actionResults.has(action)) return actionResults.get(action);
    activeActions.add(action);
    const next = pruneAction(action.get(key("Next")));
    if (next) action.set(key("Next"), next); else action.delete(key("Next"));
    let kept = value;
    if (named(action.get(key("S"))) === "GoTo" && deadDestination(action.get(key("D")))) {
      kept = next;
      const following = pdf.context.lookup(next);
      if (following instanceof PDFArray) {
        kept = following.get(0);
        const first = dict(pdf, kept), rest = following.asArray().slice(1);
        if (first && rest.length) {
          const original = first.get(key("Next")), resolved = pdf.context.lookup(original);
          first.set(key("Next"), pdf.context.obj([...(resolved instanceof PDFArray ? resolved.asArray() : original ? [original] : []), ...rest]));
        }
      }
    }
    activeActions.delete(action); actionResults.set(action, kept);
    return kept;
  };
  const cleanAction = (owner: PDFDict, name: string) => {
    const previous = owner.get(key(name));
    const kept = pruneAction(previous);
    if (kept) owner.set(key(name), kept); else owner.delete(key(name));
    return !!previous && !kept;
  };
  const visited = new Set<PDFDict>();
  const pruneOutline = (parent: PDFDict): number => {
    if (visited.has(parent)) throw new Error("This PDF has a damaged bookmark tree.");
    visited.add(parent);
    const remaining: { ref: PDFObject; node: PDFDict; descendants: number }[] = [];
    let next = parent.get(key("First"));
    while (next) {
      const node = dict(pdf, next);
      if (!node || visited.has(node)) throw new Error("This PDF has a damaged bookmark tree.");
      const ref = next; next = node.get(key("Next"));
      const descendants = pruneOutline(node);
      const removedAction = cleanAction(node, "A");
      const removed = deadDestination(node.get(key("Dest"))) || removedAction;
      if (removed) { node.delete(key("Dest")); node.delete(key("A")); }
      if (!removed || descendants) remaining.push({ ref, node, descendants });
    }
    parent.delete(key("First")); parent.delete(key("Last"));
    remaining.forEach(({ ref, node, descendants }, index) => {
      node.delete(key("Prev")); node.delete(key("Next"));
      if (index) node.set(key("Prev"), remaining[index - 1].ref);
      if (index + 1 < remaining.length) node.set(key("Next"), remaining[index + 1].ref);
      const count = node.lookupMaybe(key("Count"), PDFNumber)?.asNumber() ?? 0;
      if (descendants) node.set(key("Count"), PDFNumber.of((count < 0 ? -1 : 1) * descendants)); else node.delete(key("Count"));
      if (!index) parent.set(key("First"), ref);
      parent.set(key("Last"), ref);
    });
    return remaining.reduce((count, item) => count + 1 + ((item.node.lookupMaybe(key("Count"), PDFNumber)?.asNumber() ?? 0) < 0 ? 0 : item.descendants), 0);
  };
  const outline = dict(pdf, pdf.catalog.get(key("Outlines")));
  if (outline) outline.set(key("Count"), PDFNumber.of(pruneOutline(outline)));
  const openAction = pdf.catalog.get(key("OpenAction"));
  if (deadDestination(openAction)) pdf.catalog.delete(key("OpenAction"));
  else if (dict(pdf, openAction)) cleanAction(pdf.catalog, "OpenAction");
  for (const page of pdf.getPages()) {
    if (deleted.has(String(page.ref))) continue;
    const annotations = page.node.Annots();
    if (annotations) for (let index = annotations.size() - 1; index >= 0; index--) {
      const annotation = dict(pdf, annotations.get(index));
      if (annotation) { const removedAction = cleanAction(annotation, "A"); if (deadDestination(annotation.get(key("Dest"))) || removedAction) annotations.remove(index); }
    }
  }
  for (const [, object] of pdf.context.enumerateIndirectObjects()) if (object instanceof PDFDict) {
    cleanAction(object, "A");
    const additional = dict(pdf, object.get(key("AA")));
    for (const [name] of additional?.entries() ?? []) cleanAction(additional!, name.decodeText());
  }
  const form = dict(pdf, pdf.catalog.get(key("AcroForm")));
  const fieldNodes = new Set<PDFDict>();
  const retainedFields = new Set<PDFDict>();
  const pruneFields = (fields: PDFArray) => {
    for (let index = fields.size() - 1; index >= 0; index--) {
      const ref = fields.get(index), field = dict(pdf, ref);
      if (!field) throw new Error("This PDF has a damaged form field tree.");
      if (fieldNodes.has(field)) throw new Error("This PDF has a damaged form field tree.");
      fieldNodes.add(field);
      if (widgets.has(String(ref)) || deleted.has(String(field.get(key("P"))))) { fields.remove(index); continue; }
      const kids = field.lookupMaybe(key("Kids"), PDFArray);
      if (kids) { pruneFields(kids); if (!kids.size()) { fields.remove(index); continue; } }
      retainedFields.add(field);
    }
  };
  const fields = form?.lookupMaybe(key("Fields"), PDFArray);
  if (fields) pruneFields(fields);
  const calculationOrder = form?.lookupMaybe(key("CO"), PDFArray);
  if (calculationOrder) for (let index = calculationOrder.size() - 1; index >= 0; index--) {
    const field = dict(pdf, calculationOrder.get(index));
    if (field && (!retainedFields.has(field) || widgets.has(String(calculationOrder.get(index))) || deleted.has(String(field.get(key("P")))))) calculationOrder.remove(index);
  }
}

/** All indices are zero-based. The input bytes remain untouched; callers own Undo snapshots. */
export async function changePdfPages(bytes: Uint8Array, change: PdfPageChange, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const pdf = await read(bytes);
  signal?.throwIfAborted();
  const count = pdf.getPageCount();
  if (change.type === "delete" || change.type === "rotate") {
    const selected = [...new Set(change.pages)].sort((a, b) => a - b);
    if (!selected.length || selected.some(index => !Number.isSafeInteger(index) || index < 0 || index >= count)) throw new Error("Select existing pages first.");
    if (change.type === "delete") {
      if (selected.length === count) throw new Error("Keep at least one page in the PDF.");
      checkStructure(pdf);
      const pages = selected.map(index => pdf.getPage(index));
      const deleted = new Set(pages.map(page => String(page.ref)));
      const widgets = new Set(pages.flatMap(page => page.node.Annots()?.asArray().filter(ref => named(dict(pdf, ref)?.get(key("Subtype"))) === "Widget").map(String) ?? []));
      pruneTags(pdf, deleted);
      pruneDeletedPages(pdf, deleted, widgets);
      for (const index of selected.reverse()) pdf.removePage(index);
    } else for (const index of selected) { const page = pdf.getPage(index); page.setRotation(degrees((page.getRotation().angle + 90) % 360)); }
  } else {
    checkStructure(pdf);
    if (!Number.isSafeInteger(change.index) || change.index < 0 || change.index > count) throw new Error("Choose an existing insertion position.");
    if (change.type === "blank") {
      if (!Number.isSafeInteger(change.matchPage) || change.matchPage < 0 || change.matchPage >= count) throw new Error("Choose an existing page size.");
      checkPageCount(count + 1);
      const reference = pdf.getPage(change.matchPage);
      const page = pdf.insertPage(change.index, [reference.getWidth(), reference.getHeight()]);
      page.setRotation(reference.getRotation());
    } else {
      const source = await read(change.bytes);
      checkStructure(source);
      checkPageCount(count + source.getPageCount());
      const form = dict(source, source.catalog.get(key("AcroForm")));
      if ((form?.lookupMaybe(key("Fields"), PDFArray)?.size() ?? 0) > 0) throw new Error("Inserting PDFs with form fields is not supported yet. No pages were changed.");
      const sourcePages = prepareImportedPages(source);
      await source.flush();
      // Copy page refs through one cache: copying nodes separately leaves internal links targeting detached clones.
      const copier = PDFObjectCopier.for(source.context, pdf.context);
      sourcePages.forEach((sourcePage, offset) => {
        const ref = copier.copy(sourcePage.ref) as PDFRef;
        const node = pdf.context.lookup(ref);
        if (!(node instanceof PDFPageLeaf)) throw new Error("The inserted PDF has an invalid page tree.");
        const page = PDFPage.of(node, ref, pdf);
        pdf.insertPage(change.index + offset, page);
      });
    }
  }
  signal?.throwIfAborted();
  // A removed page must not survive as an unreferenced object in the saved copy.
  const reachable = new Set<PDFRef>();
  const visitedObjects = new Set<PDFObject>();
  const visit = (object: PDFObject | undefined) => {
    if (!object || visitedObjects.has(object)) return;
    visitedObjects.add(object);
    if (object instanceof PDFRef) { reachable.add(object); visit(pdf.context.lookup(object)); }
    else if (object instanceof PDFDict) for (const [, value] of object.entries()) visit(value);
    else if (object instanceof PDFArray) for (const value of object.asArray()) visit(value);
    else if (object instanceof PDFStream) visit(object.dict);
  };
  for (const value of Object.values(pdf.context.trailerInfo)) visit(value);
  for (const [ref] of pdf.context.enumerateIndirectObjects()) if (!reachable.has(ref)) pdf.context.delete(ref);
  const output = await pdf.save({ updateFieldAppearances: false });
  signal?.throwIfAborted();
  checkPdfSize(output.byteLength);
  return output;
}
