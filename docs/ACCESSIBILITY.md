# Accessibility

Conversation Roadmap targets WCAG 2.0, 2.1, and 2.2 Level A and AA. It also
uses the stricter 4.5:1 Microsoft Accessibility Standard threshold for custom
node colors and component indicators.

## Supported interaction

- Graph nodes expose their title, type, status, New/Important state, and
  incoming/outgoing relationships to assistive technologies.
- Outline view provides keyboard navigation for nodes and a keyboard-accessible
  list of graph connections.
- A selected node can create a connection with standard form controls, avoiding
  a pointer-only dependency on React Flow handles.
- A selected node can be repositioned with four keyboard-operable nudge
  buttons, avoiding a pointer-only dependency on drag and drop.
- Dialogs move focus inside, trap Tab navigation, close with Escape, restore
  focus when dismissed, and make background content inert.
- Visible focus indicators use VS Code high-contrast theme tokens.
- Highlighted and new nodes include text labels rather than relying on color.
- Animations and transitions are disabled when `prefers-reduced-motion` is set.

## Automated scan

The release audit used axe-core 4.10.2 with these tags:

- `wcag2a`
- `wcag2aa`
- `wcag21a`
- `wcag21aa`
- `wcag22a`
- `wcag22aa`

The actual bundled Webview was rendered with synthetic conversation data and
scanned in seven states:

1. Graph
2. Graph with node details
3. Resume dialog
4. Merge dialog
5. Graph with connection details
6. Outline
7. Session transcript

Result: **0 violations** in every state. Axe marked layered SVG edge labels and
partially obscured textareas as requiring manual contrast review because it
could not infer their backgrounds. In the audit theme, these controls use
`#1f1f1f` text on `#ffffff`, a **16.48:1** ratio. Custom node and New-sticker
contrast remains covered by the unit tests in `test/webview/nodeColor.test.ts`.

## Manual checks

Before Marketplace publication, repeat keyboard, screen-reader, zoom/reflow,
high-contrast theme, and reduced-motion checks in a current VS Code Extension
Development Host. Automated analysis cannot validate the usability of the
spatial graph or announcements produced by a specific screen reader.
