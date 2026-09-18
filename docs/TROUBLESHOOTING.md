# Troubleshooting & Known Limitations

## Known limitation: only `@roadmap` turns are captured

Conversation Roadmap registers a chat participant (`@roadmap`) using VS
Code's public `vscode.chat` API. That API only ever invokes a participant's
handler for messages **explicitly addressed to it** - there is no public API
that lets an extension read messages sent to other participants, to
unscoped chat, or to chat history from before the extension was installed.

Practically, this means:

- History from other chat participants (including unscoped `@workspace`,
  `@vscode`, or plain chat) never appears in the roadmap graph.
- Turns sent before you start addressing `@roadmap` in a conversation are
  not retroactively captured.
- If you want a turn on the roadmap, address it to `@roadmap` directly.

This is shown as a one-time onboarding notice the first time the extension
activates (see **Roadmap: Show Onboarding and Known Limitations** to reopen
it), and it is not a bug - it is the boundary of what the public chat API
exposes.

## The graph looks empty after opening it

- Run **Roadmap: Open Graph** again; it always reloads from disk.
- Confirm you have addressed at least one message to `@roadmap` in this
  workspace - see the limitation above.
- Check the **Session transcript** view (in the graph panel) to confirm
  turns were captured even if summarization has not yet produced nodes.

## A turn was captured but no graph node appeared

- Summarization runs automatically after each captured turn, but a model
  call can fail (e.g. no authorized language model is available) or the
  model's response can fail schema validation; in both cases the graph is
  left unchanged rather than corrupted. The turn itself is still recorded
  and visible in the transcript view.
- Check `conversationRoadmap.showOnboarding`-style settings are not the
  cause: summarization is controlled per-roadmap by the `autoSummarize`
  setting in the graph's own settings, not a global VS Code setting.

## My edits disappeared after a reload

- Edits are validated and persisted immediately (see
  `src/webviewMessages.ts`); a malformed message is rejected before it can
  reach disk, so a successfully-applied edit should always survive a
  reload. If you see otherwise, check for an error banner in the graph
  Webview - it reports exactly which change could not be applied.

## I want to remove everything the extension has stored

Run **Roadmap: Delete All Local Data**. This permanently deletes every
captured turn and roadmap graph after a confirmation. It cannot be undone.

## Exporting a roadmap

- Use **Roadmap: Export Roadmap (JSON)** for a complete backup that can be
  imported later.
- Use **Roadmap: Export Graph + Outline (Markdown)** for a Mermaid flowchart
  and readable outline. The Markdown viewer must support Mermaid to render the
  diagram; the outline remains readable when it does not.
- Use **Roadmap: Export Visual Graph (SVG)** for a standalone vector image.
  SVG preserves the effective node layout and can be opened in a browser or
  inserted into documents.

## Installing the packaged extension (VSIX)

1. `npm install`
2. `npm run compile`
3. `npm run package` (produces a `.vsix` file using `@vscode/vsce`)
4. In VS Code: Extensions view -> `...` menu -> **Install from VSIX...**,
   or `code --install-extension conversation-roadmap-<version>.vsix`.
5. Reload the window. Address a message to `@roadmap` in the Chat view,
   then run **Roadmap: Open Graph**.

To verify in a clean environment (no other settings/extensions carried
over), launch VS Code with a fresh profile before installing:

```
code --profile "Roadmap Clean Test"
```
