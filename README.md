# Conversation Roadmap (Phase 1 spike)

Minimal VS Code extension skeleton validating the feasibility of the
Conversation Roadmap product. This is the Phase 1 technical spike only -
no domain model, schema, or summarization yet (see later phases).

## What this spike proves

- A `@roadmap` chat participant can be registered and only receives
  requests explicitly addressed to it (`contributes.chatParticipants` +
  `vscode.chat.createChatParticipant`).
- Each request/response turn is logged to local disk
  (`src/turnStore.ts`), using only `context.globalStorageUri` and Node's
  `fs` module - no undocumented VS Code APIs.
- A graph Webview (`src/webviewPanel.ts` + `src/webview/`, a React + React
  Flow app bundled with `esbuild.js` into `media/graph.js`) renders the
  persisted roadmap graph: pan/zoom/minimap/fit-to-view, node selection with
  a transcript detail panel, dragging to reposition nodes, and editing a
  node's title, notes, tags, color, and highlight state. An accessible
  outline/tree view is available as a keyboard-only alternative to the
  canvas. A third "Session transcript" view lets you browse the raw
  captured turns grouped by chat **session** via session chips at the top -
  a new chat starts a fresh session, older sessions stay selectable, the
  view follows the newest session by default until you click into an older
  one, and turns persisted before sessions existed are grouped as "Earlier
  turns". Every edit is sent as a Webview message that the extension host
  validates (`src/webviewMessages.ts`) before persisting it via
  `RoadmapStore`, so edits survive a reload and a malformed message can
  never corrupt the graph. The Webview's Content-Security-Policy disallows
  everything by default and only allows scripts tied to a per-load nonce;
  `style-src` additionally allows `'unsafe-inline'` so React can apply
  inline styles (color swatches, outline indentation).
- Storage survives a reload: the "Roadmap: Open Graph" command re-reads
  `turns.json` from disk every time it runs, so turns captured in a prior
  session are still shown after a restart.

## Resume from a Node (Phase 7)

Selecting a node and choosing **Resume from here** (in the node details
panel, or the **Conversation Roadmap: Resume from Selected Node** command)
starts a *new* branch of conversation seeded with the context that led up to
that node:

- **Context construction** (`src/resume/resumeContext.ts`, `vscode`-free so
  it is shared by the Webview preview, the extension host, and unit tests)
  walks the selected node's ancestor path through the graph and assembles the
  source request/response turns in order. It de-duplicates any turn shared by
  multiple nodes, is cycle-safe, and caps the number of turns and total
  characters (dropping the oldest first, flagging truncation) to **prevent
  duplicate or oversized context**.
- **Preview before sending**: a modal shows the exact context that will be
  sent and clearly states that resuming creates a new branch and does **not**
  modify the original transcript, with an optional follow-up question - per
  the product design's requirement to explain the context before a resume.
- **Traceable branch**: confirming creates a new child node linked to the
  source node by a `"branch"` edge (labelled `resume`). The source node and
  its path are left untouched, so the original transcript and graph path are
  preserved. The branch is undoable like any other graph transaction.
- **Starting the interaction / public-API constraint**: VS Code exposes **no
  public, typed API to programmatically invoke a chat participant or inject a
  user turn**, and the product design forbids depending on private/internal
  commands. The host therefore seeds a new `@roadmap` interaction by
  *prefilling* the chat input via the built-in `workbench.action.chat.open`
  command (the user still presses Enter, so nothing is sent without consent),
  probing for the command first and falling back to copying the context to
  the clipboard if it is unavailable. Because the branch node/edge is created
  and persisted regardless, the branch stays traceable even if the chat is
  never opened. A consequence of this constraint: automatically linking the
  *future* resumed turn's captured record back into the branch node's
  `sourceRefs` is not possible through public APIs until the user sends the
  message and a later summarization pass runs.

## Running

```
npm install
npm run compile
```

Then press F5 in VS Code to launch an Extension Development Host, open
the Chat view, and address a message to `@roadmap`. Run the
**Roadmap: Open Graph** command to view the captured turns as a graph.

## Tests

```
npm test
```

Unit tests cover `TurnStore` (`test/turnStore.test.ts`), the domain model
(`test/model/`), incremental summarization (`test/summarization/`), the
graph Webview's message validation (`test/webviewMessages.test.ts`) - every
message shape the Webview can send to the extension host, including
malformed/unrecognized ones, and that edits apply only to the targeted node
- its auto-layout fallback (`test/webview/layout.test.ts`), and resume-branch
construction (`test/resume/`): ancestor-path context building with
de-duplication and size caps, and branch node/edge creation that leaves the
original path unchanged.
