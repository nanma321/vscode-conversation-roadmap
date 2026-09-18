# Changelog

All notable changes to the "Conversation Roadmap" extension are documented
in this file.

## [Unreleased] - Phase 10: Release Preparation

- Added a one-time onboarding notice (`Roadmap: Show Onboarding and Known
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
