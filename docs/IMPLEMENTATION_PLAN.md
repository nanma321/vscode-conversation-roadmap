# Conversation Roadmap Implementation Plan

This document records the completed ten-phase implementation plan. Subsequent
hackathon polish, accessibility hardening, demo media, CI, and export additions
are tracked in the repository changelog.

## Objective

Build a production-quality VS Code extension that captures conversations
involving its own chat participant and presents them as an editable, branching
roadmap with source-message navigation and context-based resume.

## Phase 1: Validate the Product Spike

**Status:** DONE

### Deliverables

- [DONE] Minimal VS Code extension.
- [DONE] Registered `@roadmap` chat participant.
- [DONE] Logging of accessible request and response history.
- [DONE] Basic Webview that displays a static graph.
- [DONE] Confirmed storage and reload behavior.

### Exit Criteria

- The extension captures only supported participant messages.
- A node can display its locally stored source messages.
- No undocumented VS Code APIs are required.

## Phase 2: Establish the Domain Model

**Status:** DONE

### Tasks

- [DONE] Define TypeScript interfaces for roadmaps, nodes, edges, turns,
  references, and settings.
- [DONE] Define a versioned JSON schema.
- [DONE] Implement runtime schema validation.
- [DONE] Implement atomic persistence.
- [DONE] Implement schema migration infrastructure.
- [DONE] Add unit tests for validation, persistence, and migrations.

### Exit Criteria

- Roadmaps survive extension restart.
- Invalid data is rejected without corrupting prior data.
- A version-one export can round-trip without information loss.

## Phase 3: Capture Conversations

**Status:** DONE

### Tasks

- [DONE] Store requests received by `@roadmap`.
- [DONE] Capture generated responses after successful completion.
- [DONE] Assign stable session and turn identifiers.
- [DONE] Record timestamps and supported references.
- [DONE] Handle cancellation and model failures explicitly.
- [DONE] Add tests for successful, cancelled, and failed turns.

### Exit Criteria

- Every stored turn has stable provenance.
- Failed or cancelled responses are not presented as complete.

## Phase 4: Build Incremental Summarization

**Status:** DONE

### Tasks

- [DONE] Design the structured summarization prompt.
- [DONE] Define the model response schema.
- [DONE] Validate every model response.
- [DONE] Implement conservative topic continuation and branch creation.
- [DONE] Extract decisions, questions, tasks, outcomes, and blockers.
- [DONE] Protect user-authored fields and structure.
- [DONE] Add fixtures for common conversation patterns.

### Exit Criteria

- A representative ten-turn conversation produces a useful graph.
- Every generated node cites at least one source turn.
- Invalid model output leaves the previous graph unchanged.

## Phase 5: Implement the Graph Webview

**Status:** DONE

### Tasks

- [DONE] Set up React, TypeScript, and React Flow.
- [DONE] Implement graph rendering, zoom, pan, minimap, and fit-to-view.
- [DONE] Add node selection and a transcript detail panel.
- [DONE] Add dragging, renaming, notes, tags, colors, and highlighting.
- [DONE] Persist node positions and user edits.
- [DONE] Add an accessible outline/tree alternative.
- [DONE] Validate all Webview messages in the extension host.

### Exit Criteria

- Users can inspect and edit a graph without losing changes after reload.
- Core operations are keyboard accessible.

## Phase 6: Add Structural Editing

**Status:** DONE

### Tasks

- [DONE] Implement user-defined edges.
- [DONE] Implement merge and split operations.
- [DONE] Add confirmation for destructive operations.
- [DONE] Add undo and redo using graph transactions.
- [DONE] Distinguish semantic edges from visual layout.
- [DONE] Add tests ensuring provenance survives structural edits.

### Exit Criteria

- Users can correct an inaccurate AI-generated graph.
- Undo restores the exact prior graph state.

## Phase 7: Resume from a Node

**Status:** DONE

### Tasks

- [DONE] Build context from the selected node and its ancestor path.
- [DONE] Show a preview of the context before sending.
- [DONE] Start a new participant interaction using the selected context.
- [DONE] Create a branch edge from the source node.
- [DONE] Prevent duplicate or oversized context.
- [DONE] Add tests for branching and context construction.

### Exit Criteria

- **Resume from here** creates a traceable child branch.
- The original transcript and graph path remain unchanged.

## Phase 8: Search, Import, and Export

**Status:** DONE

### Tasks

- [DONE] Add graph and transcript search.
- [DONE] Add filters for type, status, tags, highlights, and newest nodes.
- [DONE] Implement versioned JSON export and import.
- [DONE] Implement Mermaid Markdown graph and readable outline export.
- [DONE] Implement standalone accessible SVG graph export.
- [DONE] Validate imports and report conflicts.

### Exit Criteria

- Exported data can be imported into a clean installation.
- Search locates both summaries and source text.

## Phase 9: Security, Privacy, and Reliability

**Status:** DONE

### Tasks

- [DONE] Apply a strict Webview Content Security Policy.
- [DONE] Audit extension-to-Webview messages.
- [DONE] Add local data deletion controls.
- [DONE] Ensure telemetry excludes conversation content.
- [DONE] Test large conversations and incremental compaction.
- [DONE] Add recovery for interrupted writes.
- [DONE] Verify behavior across supported VS Code versions.

### Exit Criteria

- Threat review has no unresolved high-severity findings.
- Storage recovery and deletion work as documented.

## Phase 10: Release Preparation

**Status:** DONE

**Completed:** 2026-09-17

### Tasks

- [DONE] Create onboarding that explains the participant-only history
  limitation.
- [DONE] Add settings, command descriptions, icons, and Marketplace metadata.
- [DONE] Write user documentation and troubleshooting guidance.
- [DONE] Run unit, integration, Webview, accessibility, and acceptance tests.
- [DONE] Package and install the VSIX in an isolated VS Code environment.
- [DONE] Prepare synthetic-data demo media and publish the project to GitHub.
- [DONE] Prepare for a small beta and feedback prioritization. Beta testing is
  an ongoing post-release activity handled outside the codebase.

### Exit Criteria

- [x] The VSIX installs and runs in a clean environment.
- [x] MVP acceptance tests pass.
- [x] Known limitations are visible before first use.
- [x] Public CI compiles, tests, packages, and uploads the VSIX.

## Recommended Delivery Sequence

1. Complete Phases 1-3 as a technical foundation.
2. Prototype Phases 4-5 together to test graph usefulness early.
3. Complete Phases 6-8 for the full MVP workflow.
4. Complete Phases 9-10 before public distribution.

## Key Engineering Principles

- Use only public VS Code APIs.
- Preserve source-message provenance.
- Never overwrite user-authored graph changes automatically.
- Validate all AI-generated and imported data.
- Store conversation content locally by default.
- Treat the graph as a reversible view over conversation history, not as a
  replacement for that history.

## First Development Milestone

The first milestone demonstrated:

- A working `@roadmap` participant.
- Capture of five or more conversation turns.
- A persisted graph with at least two topics.
- Node selection that displays source messages.
- Manual node movement and highlighting.

This milestone was completed before merge, split, import, export, and advanced
layout work.
