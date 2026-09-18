# Changelog

All notable changes to the "Conversation Roadmap" extension are documented
in this file.

## [0.1.2] - 2026-09-18

- Fill the single pre-created Resume node with the submitted resumed response
  instead of creating a redundant second Resume/response node.
- Keep later turns in the resumed branch as a chain beneath its latest response.
- Move **Resume from here** near the top of node details as a primary action.
- Center parents over child subtrees and propagate moved-parent offsets to
  automatic descendants.
- Limit graph cards to three visible tags plus a `+N` indicator while keeping
  every tag available in details, filters, search, and exports.

## [0.1.1] - 2026-09-18

- Ensure every distinct non-empty participant prompt adds at most one new
  roadmap node instead of disappearing into a topic or creating a redundant
  topic/question pair.
- Backfill previously collapsed same-topic prompts into child request nodes
  when the graph is opened, without another model call.
- Keep node cards fixed-width and truncate overflowing tag labels.
- Switch automatic graph layout to stable top-down placement, with children
  below parents and siblings left-to-right.
- Bring the newest node batch into view without repeatedly recentering after
  ordinary edits.

## [0.1.0] - 2026-09-18

- Added Webview accessibility improvements: full React type-checking, modal
  focus management, inert dialog backgrounds, screen-reader relationship
  descriptions, keyboard-accessible connection editing and node movement,
  main landmarks, and reduced-motion support.
- Added Mermaid graph output to Markdown exports and a standalone accessible
  SVG graph export command.
- Added a synthetic-data hackathon demo as an animated GIF and a 76-second
  captioned, text-to-speech narrated video with a readable transcript.
- Published the completed ten-phase implementation plan and formal
  accessibility assessment with raw axe-core results.
- Automatically prepares `@roadmap` as a non-submitting partial query after
  each participant response, with a setting and Command Palette fallback.
- Simplified Command Palette titles so the Conversation Roadmap category
  appears exactly once.
- Increased default graph connection thickness for readability.
- Added a one-time onboarding notice (`Conversation Roadmap: Show Onboarding and Known
  Limitations` command) that explains the participant-only history
  limitation - only messages explicitly addressed to `@roadmap` can be
  captured - before first use. Can be disabled via the
  `conversationRoadmap.showOnboarding` setting.
- Added Marketplace metadata to `package.json` (publisher, license,
  repository, keywords, gallery banner, extension icon).
- Added categories and icons to every command, and a
  `docs/TROUBLESHOOTING.md` guide covering known limitations and common
  issues.
- Added an `npm run package` script to build a distributable `.vsix`.

## Phase 1-9

See `README.md` for the full history of the technical spike (Phase 1)
through security/privacy/reliability hardening (Phase 9).
