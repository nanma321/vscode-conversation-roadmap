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
- and its auto-layout fallback (`test/webview/layout.test.ts`).
