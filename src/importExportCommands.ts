/**
 * Command entry points for versioned JSON export/import and Markdown
 * outline export (Phase 8). Thin `vscode`-dependent glue over the pure
 * logic in `model/exportImport.ts` and `model/markdownExport.ts`: this
 * module's only job is file dialogs and user-facing messaging, so the
 * actual export/import/validation logic stays unit-testable without the
 * extension host.
 */
import * as vscode from "vscode";
import { RoadmapStore } from "./model/roadmapStore";
import { exportRoadmapDocument, parseImportPayload, planImport } from "./model/exportImport";
import { exportRoadmapToMarkdown } from "./model/markdownExport";
import { exportRoadmapToSvg } from "./export/svgExport";

/** "Conversation Roadmap: Export Roadmap (JSON)" - writes the full, currently persisted document to a user-chosen `.json` file. */
export async function exportRoadmapCommand(roadmapStore: RoadmapStore): Promise<void> {
  const document = await roadmapStore.load();
  const uri = await vscode.window.showSaveDialog({
    filters: { "JSON": ["json"] },
    saveLabel: "Export Roadmap",
    defaultUri: vscode.Uri.file("roadmap-export.json"),
  });
  if (!uri) {
    return;
  }
  const contents = exportRoadmapDocument(document);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, "utf8"));
  void vscode.window.showInformationMessage(`Roadmap exported to ${uri.fsPath}`);
}

/**
 * "Conversation Roadmap: Import Roadmap (JSON)" - reads a user-chosen `.json` file,
 * validates it (rejecting anything malformed or unmigratable without
 * touching persisted state), and merges it into the current document.
 * Any roadmap id collision is never silently overwritten: the incoming
 * roadmap is imported under a renamed id and every such conflict is
 * reported to the user, per the Key Engineering Principle that user data
 * (here, the existing roadmap) must never be automatically overwritten.
 */
export async function importRoadmapCommand(roadmapStore: RoadmapStore): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { "JSON": ["json"] },
    openLabel: "Import Roadmap",
  });
  const uri = uris?.[0];
  if (!uri) {
    return;
  }

  let raw: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    raw = Buffer.from(bytes).toString("utf8");
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not read import file: ${(err as Error).message}`);
    return;
  }

  const parsed = parseImportPayload(raw);
  if (!parsed.valid || !parsed.document) {
    void vscode.window.showErrorMessage(`Import failed - the file is not a valid roadmap export:\n${parsed.errors.join("\n")}`);
    return;
  }

  const existing = await roadmapStore.load();
  const plan = planImport(existing, parsed.document);
  await roadmapStore.save(plan.document);

  if (plan.conflicts.length > 0) {
    const details = plan.conflicts.map((c) => `"${c.originalId}" -> imported as "${c.importedAsId}"`).join("; ");
    void vscode.window.showWarningMessage(
      `Roadmap imported with ${plan.conflicts.length} id conflict(s) resolved by renaming: ${details}`
    );
  } else {
    void vscode.window.showInformationMessage(`Roadmap imported: ${plan.importedRoadmapIds.length} roadmap(s) added.`);
  }
}

/** "Conversation Roadmap: Export Graph + Outline (Markdown)" - writes Mermaid plus a readable outline to a `.md` file. */
export async function exportMarkdownOutlineCommand(roadmapStore: RoadmapStore): Promise<void> {
  const document = await roadmapStore.load();
  const roadmap = document.roadmaps[0];
  if (!roadmap) {
    void vscode.window.showInformationMessage("No roadmap to export yet.");
    return;
  }
  const uri = await vscode.window.showSaveDialog({
    filters: { "Markdown": ["md"] },
    saveLabel: "Export Markdown",
    defaultUri: vscode.Uri.file("roadmap.md"),
  });
  if (!uri) {
    return;
  }
  const contents = exportRoadmapToMarkdown(roadmap);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, "utf8"));
  void vscode.window.showInformationMessage(`Roadmap Markdown exported to ${uri.fsPath}`);
}

/** "Conversation Roadmap: Export Visual Graph (SVG)" - writes a standalone vector rendering of the default roadmap. */
export async function exportSvgCommand(roadmapStore: RoadmapStore): Promise<void> {
  const document = await roadmapStore.load();
  const roadmap = document.roadmaps[0];
  if (!roadmap) {
    void vscode.window.showInformationMessage("No roadmap to export yet.");
    return;
  }
  const uri = await vscode.window.showSaveDialog({
    filters: { "SVG": ["svg"] },
    saveLabel: "Export SVG",
    defaultUri: vscode.Uri.file("roadmap.svg"),
  });
  if (!uri) {
    return;
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(exportRoadmapToSvg(roadmap), "utf8"));
  void vscode.window.showInformationMessage(`Roadmap SVG exported to ${uri.fsPath}`);
}
