# Troubleshooting & Known Limitations

Conversation Roadmap 0.1.4 requires VS Code 1.137 or later. Older versions are
blocked at installation because their non-submitting chat-prefill behavior is
not compatible with this release.

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
activates (see **Conversation Roadmap: Show Onboarding and Known Limitations** to reopen
it), and it is not a bug - it is the boundary of what the public chat API
exposes.

## A short follow-up behaves as if earlier messages were missing

Version 0.1.3 and later sends the accessible `@roadmap` request/Markdown
response history to the selected language model. History is explicitly bounded
by message and character budgets: the newest coherent exchanges are retained,
along with the active Resume seed and its response when continuing a branch.
Buttons, file trees, anchors, metadata, and other non-text response parts are
not converted into invented prompt text.

When the history budget is reached, the chat shows a progress notice with the
number of omitted messages and characters. The same request sent to the model
contains an explicit instruction that content was omitted and must not be
inferred. This notice is not shown when nothing was compacted.

VS Code's public chat API does not expose an opaque conversation identifier.
Conversation Roadmap therefore returns its session identifier as JSON-safe
`ChatResult.metadata` and recovers it from the next `ChatResponseTurn`. This
keeps updated and interleaved chats separate. Responses created before version
0.1.3 do not contain that metadata, so the first new turn in an already-open
older chat can begin one new roadmap session segment; later turns in that chat
remain stable.

## `@roadmap` disappears before my next question

The extension requests sticky-participant behavior with `isSticky: true`, but
some VS Code chat surfaces or versions can still remove the participant chip
after a response. Once the chip is gone, an unscoped follow-up is routed to
default Copilot and is not exposed to this extension.

By default, the extension uses partial-query mode after every Roadmap response
to prepare `@roadmap ` in the chat input without sending it. Disable this with
`conversationRoadmap.autoPrefillMention` if you prefer manual selection.

The **Conversation Roadmap: Continue with @roadmap** Command Palette action repeats the
prefill on demand. If VS Code's chat prefill command is unavailable, the action
copies the mention to the clipboard and explains the fallback.

## The graph looks empty after opening it

- Run **Conversation Roadmap: Open Graph** again; it always reloads from disk.
- Confirm you have addressed at least one message to `@roadmap` in this
  workspace - see the limitation above.
- Check the **Session transcript** view (in the graph panel) to confirm
  turns were captured even if summarization has not yet produced nodes.

## A turn was captured but no graph node appeared

- Summarization runs automatically after each captured turn. A failed model,
  JSON, schema, or graph-application attempt remains eligible for one later
  retry. The retry count is persisted, so reloading VS Code cannot create an
  unbounded model-call loop.
- After the second failure, Conversation Roadmap persists an **Automatic
  summary unavailable** node linked to the original source turn. It contains
  no fabricated summary or classification. VS Code and the open graph show one
  aggregated warning for the run.
- Check `conversationRoadmap.showOnboarding`-style settings are not the
  cause: summarization is controlled per-roadmap by the `autoSummarize`
  setting in the graph's own settings, not a global VS Code setting.

## An attached file or selection was not used

- Only references explicitly attached to the current or retained historical
  `@roadmap` requests are considered. Conversation Roadmap never scans the
  workspace for extra files.
- Text, URI, and Location/selection references are supported. Location ranges
  are applied to the current document; an out-of-date or unreadable selection
  is reported as unavailable.
- Each reference and the combined reference context have strict character
  limits. Current references are retained first, then the newest historical
  references. Duplicate references are included once.
- Unsupported and unreadable references produce a single aggregated progress
  warning and an explicit unavailable marker; their contents are never guessed.

## Storage could not be loaded and writes are blocked

If `turns.json` or `roadmaps.json` is unreadable, malformed, or fails
validation, Conversation Roadmap stops all mutations for that store. It leaves
the original bytes untouched and attempts a timestamped
`*.recovery-<timestamp>.bak` diagnostic copy beside the file.
It also creates a durable `.blocked` marker and uses an exclusive file lock so
another VS Code window cannot overwrite the unsafe original.

Use the error's **Open Storage Folder** action, close every VS Code window,
inspect or restore the named original file, and then reload VS Code. A fresh
successful load clears the marker. Do not replace the original with the
diagnostic copy unless you have verified that the copy is valid. If backup or
marker creation failed, the error reports that separately and writes remain
blocked.

## My edits disappeared after a reload

- Edits are validated and persisted immediately (see
  `src/webviewMessages.ts`); a malformed message is rejected before it can
  reach disk, so a successfully-applied edit should always survive a
  reload. If you see otherwise, check for an error banner in the graph
  Webview - it reports exactly which change could not be applied.

## I want to remove everything the extension has stored

Run **Conversation Roadmap: Delete All Local Data**. This permanently deletes every
captured turn, roadmap graph, and recovery backup after a confirmation. It
cannot be undone.

## Exporting a roadmap

- Use **Conversation Roadmap: Export Roadmap (JSON)** for a complete backup that can be
  imported later.
- Use **Conversation Roadmap: Export Graph + Outline (Markdown)** for a Mermaid flowchart
  and readable outline. The Markdown viewer must support Mermaid to render the
  diagram; the outline remains readable when it does not.
- Use **Conversation Roadmap: Export Visual Graph (SVG)** for a standalone vector image.
  SVG preserves the effective node layout and can be opened in a browser or
  inserted into documents.

## Installing the packaged extension (VSIX)

1. `npm install`
2. `npm run compile`
3. `npm run package` (produces a `.vsix` file using `@vscode/vsce`)
4. In VS Code: Extensions view -> `...` menu -> **Install from VSIX...**,
   or `code --install-extension conversation-roadmap-<version>.vsix`.
5. Reload the window. Address a message to `@roadmap` in the Chat view,
   then run **Conversation Roadmap: Open Graph**.

To verify in a clean environment (no other settings/extensions carried
over), launch VS Code with a fresh profile before installing:

```
code --profile "Roadmap Clean Test"
```
