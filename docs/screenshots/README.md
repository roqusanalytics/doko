# Public screenshot provenance

The practical gallery uses the installed **Doko 1.20.26** macOS app and its native UI.
The fictional **Pajūrio studija** project connects a PDF brief, Word proposal, Markdown plan,
Excel budget, photo folder, and Ask AI conversation. Project documents are freshly generated
under the ignored `release/practical-capture/files/` workspace. The photo folder reuses three existing real photo source files;
no previous screenshot image is used as input.

| Capture | Actual app flow |
| --- | --- |
| `pdf-reading.png` | Open and read the project PDF brief |
| `word-document.png` | Open the `.docx` proposal and view Doko's converted PDF |
| `markdown-editor.png` | Open and read the project Markdown plan |
| `excel-workbook.png` | Open the project Excel budget |
| `photo-gallery.png` | Open the project's photo folder |
| `ask-ai.png` | Ask about the project document using an existing real provider connection |

## Refresh protocol

1. Check the installed app version and create fresh, coherent fictional project files in a temporary workspace.
2. Open each file through the installed app's normal native controls. Capture the actual window after content is readable;
   keep the same window proportions and current default appearance across captures.
3. For Ask AI, submit a real question through the app and wait for the connected provider's completed response.
   Do not inject a conversation, replace provider responses, or expose account credentials.
4. Save the six full window captures under the names above. Check each image visually for readable content,
   matching file type, and private data before replacing the public assets.
5. Create proportional JPEG derivatives of the PDF, photo, and Markdown captures for the landing page at
   `site/public/mockups/practical-{pdf,photos,markdown}-{1334,2668}.jpg`. Preserve the whole captured window;
   use its actual aspect ratio in `Landing.astro`.
6. Check all README links and the site's three screenshot tabs, including mobile layout. Updating these files
   does not publish or deploy the website.

The automated developer capture scripts are fixture generators only. `scripts/screenshots.mjs` writes to
`release/capture-fixtures/readme/` and uses a simulated local AI response; `site/scripts/capture-mockups.mjs`
writes to `release/capture-fixtures/site/`. Neither script is a source for the public practical gallery.

The original native captures are 2668 × 1740 pixels. Native capture JPEG bytes are encoded as genuine PNG for the README without changing or cropping their pixels. The website uses 1334 × 870 and 2668 × 1740 proportional derivatives; captures are not upscaled. Word is shown after Doko's actual conversion to PDF, and the Excel view is read-only. The completed Ask AI answer correctly identifies 7 920 Eur, 11 December 2026, and the three document risks.
