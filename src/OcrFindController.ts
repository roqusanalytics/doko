import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { EventBus, PDFFindController } from "./viewer";

export type PageText = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;
type TextReader = (page: PDFPageProxy) => Promise<PageText>;
type FindState = { query: string; type?: string };

/** Keep PDF.js matching, offsets and navigation; substitute text only for search. */
export class OcrFindController {
  private pdf: PDFDocumentProxy | null = null;
  private reader: TextReader | null = null;
  private generation = 0;
  private failed = false;
  private controller!: PDFFindController;
  private events!: EventBus;
  onIsPageVisible: ((n: number) => boolean) | null = null;

  constructor(private options: ConstructorParameters<typeof PDFFindController>[0]) {
    this.reset(false);
    options.eventBus.on("findbarclose", () => this.reset(false));
    options.eventBus.on("find", (state: FindState) => {
      if (!state.query?.trim()) { this.reset(false); return; }
      if (this.failed) this.reset(false);
      this.events.dispatch("find", state);
    });
  }

  get highlightMatches() { return this.controller.highlightMatches; }
  get pageMatches() { return this.controller.pageMatches; }
  get pageMatchesLength() { return this.controller.pageMatchesLength; }
  get selected() { return this.controller.selected; }
  get state() { return this.controller.state as FindState | null; }
  scrollMatchIntoView(args: Parameters<PDFFindController["scrollMatchIntoView"]>[0]) {
    this.controller.scrollMatchIntoView(args);
  }

  setDocument(pdf: PDFDocumentProxy | null) {
    if (pdf === this.pdf) return;
    this.pdf = pdf;
    this.reader = null;
    this.reset(false);
  }

  setTextReader(pdf: PDFDocumentProxy, reader: TextReader) {
    // pagesinit precedes PDFViewer's delayed setDocument after its first render.
    this.pdf = pdf;
    this.reader = reader;
    this.reset(true);
  }

  getPageText(n: number): Promise<PageText> {
    const pdf = this.pdf!, reader = this.reader;
    return pdf.getPage(n).then(page => reader ? reader(page) : page.getTextContent({ disableNormalization: true }));
  }

  private reset(resume: boolean) {
    const state = this.controller?.state as FindState | null;
    const wasOpen = this.controller?.highlightMatches;
    const pdf = this.pdf, reader = this.reader, generation = ++this.generation;
    // A new controller keeps old extraction callbacks from changing the new search's totals.
    this.controller?.setDocument(null!);
    this.events = new EventBus();
    this.controller = new PDFFindController({ ...this.options, eventBus: this.events });
    this.controller.onIsPageVisible = (n: number) => this.onIsPageVisible?.(n) ?? true;
    this.failed = false;
    for (const name of ["updatefindmatchescount", "updatefindcontrolstate", "updatetextlayermatches"]) {
      this.events.on(name, (event: object) => {
        if (generation === this.generation) this.options.eventBus.dispatch(name, event);
      });
    }
    const fail = (error: unknown): never => {
      if (generation === this.generation && (error as Error).name !== "AbortError") {
        this.failed = true;
        this.options.eventBus.dispatch("searchtexterror", { message: "Some scanned pages couldn't be searched. Search again to retry." });
      }
      throw error;
    };
    // PDF.js uses only getPage/getTextContent here. Leave the viewer's real PDF untouched.
    if (pdf) this.controller.setDocument(new Proxy(pdf, { get: (target, key) => key === "getPage" ? async (n: number) => {
      try {
        if (generation !== this.generation) throw new DOMException("Search cancelled", "AbortError");
        const page = await target.getPage(n);
        return { getTextContent: async () => {
          try {
            if (generation !== this.generation) throw new DOMException("Search cancelled", "AbortError");
            return reader ? await reader(page) : await page.getTextContent({ disableNormalization: true });
          } catch (error) { return fail(error); }
        } };
      } catch (error) { return fail(error); }
    } : Reflect.get(target, key, target) }));
    this.options.eventBus.dispatch("searchtextchanged", {});
    this.options.eventBus.dispatch("updatetextlayermatches", { pageIndex: -1 });
    if (resume && wasOpen && state) this.events.dispatch("find", { ...state, type: "" });
  }
}
