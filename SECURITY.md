# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Instead, report them privately through
[GitHub's private vulnerability reporting](https://github.com/roqusanalytics/doko/security/advisories/new).

Include the Doko version (shown in **About Doko**), what an attacker could do, and steps or a sample PDF that
reproduce it. You can expect an acknowledgement within a week. Fixes ship as a new release that installed copies pick
up automatically.

## Supported versions

Only the latest release receives security fixes. Installed copies update automatically unless automatic updates are
turned off in **Settings**. Portable copies must be updated manually.

## Security model

Doko opens untrusted PDFs, so it's built to keep a malicious document contained:

- PDFs are parsed and rendered by [pdf.js](https://github.com/mozilla/pdf.js). PDF JavaScript and XFA forms are not run.
- The interface runs in a sandboxed Electron renderer with context isolation, no Node.js access, and a strict
  Content Security Policy. Only a small, validated set of calls into the main process is exposed, and only to Doko's
  own page.
- Links inside PDFs open in your default browser, and only after a dialog from the main process shows where they go
  (a PDF decides a link's clickable area, which can be invisible). Doko never navigates its own window away from the
  app. Pasted or dropped links fill in **Open from URL** rather than opening straight away.
- Desktop imports resolve each HTTP(S) destination before connecting. A temporary, TCP-only proxy connects to the
  approved IP addresses and Chromium verifies HTTPS against the original hostname. This covers redirects and page
  subresources. Access to a local address requires approval for the specific origin and addresses in the dialog.
  The importer supports direct connections and HTTP(S) system proxies that allow tunnels to numeric addresses.
  If it cannot establish a verified route, the import fails. URL imports decline TLS client certificates for PDF downloads,
  redirects, captured webpages, and their subresources.
- Webpages opened from a link are loaded in a separate hidden window: sandboxed, no Node.js or preload, a throwaway
  in-memory session per page, every permission denied, pop-ups and downloads blocked, only http(s)/data/blob requests
  allowed, and a 60-second limit. Only the printed PDF reaches Doko.
- Word documents are converted by Microsoft Word (macros and automatic link updates disabled) or LibreOffice (a temporary
  profile with macros and linked content disabled) when installed. Otherwise Doko's own converter reads the `.docx` in a separate utility
  process with a two-minute timeout and a 768 MiB working-set limit. It counts the bytes expanded from each archive
  part (32 MiB), the total (96 MiB), and the generated HTML (48 MiB). A sandboxed window prints the result with
  JavaScript and the network off. File imports and converted PDFs have a 300 MiB limit. A saved conversion grants
  access only to the current user and is reused only after verifying both files against private SHA-256 records.
  Opening a Word file through a symbolic link skips the automatic save.
- Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, and inspector flags, and require app code to load
  from an integrity-checked archive.
- Printing hands the document to Chromium's built-in PDF viewer.
- **Ask AI** runs entirely in the main process. ChatGPT uses OpenAI's Sign in with ChatGPT (OAuth 2.0 with PKCE, a
  loopback redirect on `127.0.0.1`, state and nonce checks, and ID-token signature verification). Tokens are encrypted
  with Electron `safeStorage` (Windows DPAPI, the macOS Keychain, or the Linux secret store; kept in memory only when
  no secret store is available) and never reach the page. Claude runs the user's own, unmodified Claude
  Code CLI with all tools, MCP servers, settings, and slash commands disabled, in a private temporary folder under
  Doko's user data. Doko never handles Claude credentials. An OpenRouter API key is verified and stored with OS credential protection by the main
  process; the key is never returned to the reader. Key checks and model lookups send no document content.
  Document text goes to the chosen provider only when the user asks a question. OpenRouter forwards the request to the model's serving provider.

Known limitations:

- **Builds aren't signed with developer certificates yet.** Windows builds are unsigned and macOS builds are ad-hoc
  signed (not notarized); the release build signs both automatically once the certificates are added (see
  [SIGNING.md](SIGNING.md)). Installers are built on GitHub Actions from this repository. Updates are downloaded over
  HTTPS from [roqusanalytics/doko](https://github.com/roqusanalytics/doko) and checked against the
  SHA-512 published with each release, but without a signature the update channel is only as secure as that GitHub
  account. Until Mac builds are signed, Macs don't install updates automatically: Doko announces new versions, which
  are downloaded from the releases page.
- This fork's Linux apt repository is signed with its own public key
  (`7A6D 385E D5F6 CC7E AFC6 DC5B 06F8 53C5 9B6C B3E2`). The .deb installs it as
  `/usr/share/keyrings/folio-local-archive-keyring.gpg`, scoped with `signed-by` to
  `/etc/apt/sources.list.d/folio-local.list`. It does not replace upstream Folio's trust.
  Release checks verify both metadata signatures, the package digest and the embedded public keyring.
- Local data (recent files, reading positions, an optionally remembered signature) is stored unencrypted in your user
  profile. See [Privacy](README.md#privacy).
- Word and LibreOffice convert documents with your own permissions and aren't sandboxed further by Doko. Word is
  driven through automation, which doesn't use its Protected View. Neither is cut off from the network.
