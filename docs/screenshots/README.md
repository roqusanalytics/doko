# Public screenshot provenance

The GitHub gallery uses the installed **Doko 1.20.27** macOS app and its real native UI.
The fictional **North Coast Studio** project connects a PDF brief, Word proposal, Markdown launch plan,
Excel budget, photo folder, and Ask AI conversation. All visible document content, filenames,
spreadsheet sheet names, questions, and answers in these GitHub captures are in English.

The fresh project files and original captures live under the ignored
`release/english-capture/files/` and `release/english-capture/raw/` workspaces.
The photo folder contains three existing real source photos with English filenames;
no previous screenshot is used as an input.

| Capture | Actual app flow |
| --- | --- |
| `pdf-reading.png` | Open and read `Project-brief.pdf` |
| `word-document.png` | Open `Studio-proposal.docx` and view Doko's converted PDF |
| `markdown-editor.png` | Open and read `Launch-plan.md` in Markdown preview |
| `excel-workbook.png` | Open `Project-budget.xlsx`, with two English sheets and the cached budget total |
| `photo-gallery.png` | Open the `Photos` folder through one of its real JPEG files |
| `ask-ai.png` | Ask about the English project brief using an existing real provider connection |

## Refresh protocol

1. Check the installed app version and create fresh, coherent fictional project files in a temporary workspace.
   Use English content, filenames, sheet names, and metadata for GitHub's public gallery.
2. Open each file through the installed app's normal native controls. Capture the actual window after content is readable;
   keep the same window proportions and current appearance across captures.
3. For Ask AI, submit a real question in English and wait for the connected provider's completed response in English.
   Do not inject a conversation, replace provider responses, or expose account credentials.
4. Save the six full window captures under the names above. Check each image visually for English text,
   readable content, matching file type, and private data before replacing the public assets.
5. Check all README image links. A GitHub-only refresh does not replace or deploy the website's gallery.
   When a website refresh is requested, create proportional JPEG derivatives for its three screenshot tabs
   and preserve the full native window's aspect ratio in `site/src/components/Landing.astro`.

The landing page's existing `site/public/mockups/practical-*` JPEGs remain separate captures from
Doko 1.20.26, using the earlier fictional Pajūrio studija project. They are unchanged by this GitHub-only refresh.

The automated developer capture scripts are fixture generators only. `scripts/screenshots.mjs` writes to
`release/capture-fixtures/readme/` and uses a simulated local AI response; `site/scripts/capture-mockups.mjs`
writes to `release/capture-fixtures/site/`. Neither script is a source for the public practical gallery.

The six original full-window captures are 2668 × 1740 pixels. Native capture JPEG bytes are encoded as genuine PNG for the README without changing or cropping their pixels.
Word is shown after Doko's actual conversion to PDF, and the Excel view is read-only.
The fictional budget is EUR 7,200 of work plus a EUR 720 reserve, for EUR 7,920 excluding VAT;
the planned launch is December 11, 2026.

The completed real ChatGPT response correctly identifies the total, launch date, and the three documented risks: late copy, scope growth, and mobile readability.
