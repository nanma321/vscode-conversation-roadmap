# Accessibility Assessment

**Product:** Conversation Roadmap VS Code extension  
**Assessment date:** 2026-09-18  
**Assessment status:** PASS with documented manual follow-ups  
**Automated engine:** axe-core 4.10.2  
**Test browser:** Microsoft Edge through Playwright Core  
**Viewport:** 1536 x 960  
**Content:** Synthetic conversation and roadmap data only

## Standards and scope

The assessment ran all Level A and AA rule tags for WCAG 2.0, 2.1, and 2.2:

- `wcag2a`
- `wcag2aa`
- `wcag21a`
- `wcag21aa`
- `wcag22a`
- `wcag22aa`

Custom node colors and interactive component indicators additionally target the
Microsoft Accessibility Standard 1.4.3 threshold of 4.5:1.

The scan used the actual compiled React Webview bundle and covered seven
representative states. No iframe content was present.

## Automated results

| State | Violations | Passed rules | Incomplete rules |
|---|---:|---:|---:|
| Graph | 0 | 26 | 1 |
| Graph with node details | 0 | 28 | 1 |
| Resume dialog | 0 | 22 | 1 |
| Merge dialog | 0 | 24 | 0 |
| Graph with connection details | 0 | 27 | 1 |
| Outline | 0 | 27 | 0 |
| Session transcript | 0 | 22 | 0 |

**Automated result: 0 violations across every tested state.**

The complete machine-readable result is available in
[axe-results.json](accessibility/axe-results.json).

## Incomplete checks investigated manually

axe reported only `color-contrast` checks it could not calculate because of
layered SVG or partially obscured controls:

1. **React Flow SVG edge labels** - axe could not infer the background beneath
   the SVG text. The audit theme explicitly uses `#1f1f1f` text on `#ffffff`,
   a 16.48:1 contrast ratio.
2. **Node notes and resume textareas** - axe treated scrollable/overlaid
   textarea content as partially obscured. The controls use the same
   `#1f1f1f` foreground on `#ffffff` background in the audit theme, a 16.48:1
   ratio.
3. **Keyboard nudge arrow buttons** - axe does not treat arrow glyphs as text
   for automated contrast calculation. Each control has a programmatic name
   (`Move node up`, `Move node left`, `Move node right`, or `Move node down`),
   a visible component boundary, and a visible focus indicator.

No incomplete item represented a confirmed accessibility violation.

## Accessibility implementation reviewed

- Full `.tsx` Webview code is included in the enforced TypeScript build.
- The Webview contains a main landmark and semantic toolbar/search regions.
- Graph nodes expose title, type, status, New/Important state, and
  incoming/outgoing relationships.
- Outline view supports keyboard node navigation and connection selection.
- Connection creation/editing and node movement have non-drag keyboard paths.
- Resume and merge dialogs trap focus, close with Escape, restore prior focus,
  and make background content inert.
- Visible focus styles use VS Code contrast tokens.
- Highlight and New states include text, not color alone.
- Custom node foreground colors are selected by measured contrast.
- Reduced-motion preferences disable graph animation and transitions.
- The unit suite tests the default colors, all built-in swatches, and a
  representative 4,096-color RGB grid against the 4.5:1 threshold.

## Supporting validation

- Enforced local test suite: **311 passing**
- Public GitHub Actions CI: build, tests, VSIX packaging, and artifact upload
  passing
- VSIX installed successfully in an isolated VS Code user-data and extensions
  environment
- Synthetic-data demo includes burned-in captions and a text transcript

## Remaining manual release checks

Automated analysis cannot fully assess:

- Announcement quality with each supported screen reader.
- Spatial graph usability at high zoom or operating-system magnification.
- Every third-party VS Code color theme and high-contrast mode.
- User comprehension of graph relationships and resume behavior.

Before Marketplace publication, repeat keyboard, screen-reader, zoom/reflow,
high-contrast theme, and reduced-motion checks in a current Extension
Development Host.
