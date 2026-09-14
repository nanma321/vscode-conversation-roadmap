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
- A basic Webview (`src/webviewPanel.ts`) renders a live graph of
  captured turns; selecting a node reveals its stored source request and
  response text. The graph updates in real time as new turns arrive
  (`TurnStore.onDidChange` -> `postMessage`), preserving the selected node.
- Turns are grouped into **sessions**: a new chat starts a fresh roadmap
  (detected when the chat has no prior `@roadmap` history), while earlier
  chats stay selectable via the session chips at the top of the graph. The
  view follows the newest chat by default until you click into an older one.
  Turns persisted before sessions existed are grouped as "Earlier turns".
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

Unit tests cover `TurnStore` (`test/turnStore.test.ts`): empty startup,
append + read-back, persistence across a fresh `TurnStore` instance
(simulating a restart), preservation of incomplete/cancelled turns,
lookup of a node's source messages by id, `onDidChange` change
notifications (used for live graph refresh), and normalization of
legacy turns that predate the session model.
