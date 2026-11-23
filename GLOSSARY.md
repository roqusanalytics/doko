# Glossary

**Canvas**
A document kind: an infinite drawing surface where the user draws, writes and places shapes, diagrams and images. Opens in its own tab like any other document.
_Avoid_: Whiteboard, Board, Drobė (in UI)

**Element**
One object on a Canvas: a shape, line, arrow, freehand stroke, text, image or frame.
_Avoid_: Item, Object, Node

**Scene**
All Elements on one Canvas at a given moment.

**Document state**
The draft state of the one document a reader tab holds: what has changed, whether it is unsaved, what a save will write, and what can be undone. Covers PDFs, the PDF text editor, page order, the photo gallery and operation undo; Markdown and other content documents keep their own.
_Avoid_: Document session (session.ts already means reading position), Draft (reserved for its parts, such as page draft and photo drafts)
