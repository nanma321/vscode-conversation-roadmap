import * as vscode from "vscode";
import {
  AttachedReference,
  ReferenceRange,
  ReferenceResourceReader,
} from "./referenceContext";

function toRange(range: vscode.Range): ReferenceRange {
  return {
    start: {
      line: range.start.line,
      character: range.start.character,
    },
    end: {
      line: range.end.line,
      character: range.end.character,
    },
  };
}

export function toAttachedReference(
  reference: vscode.ChatPromptReference
): AttachedReference {
  const common = {
    id: reference.id,
    ...(reference.modelDescription
      ? { description: reference.modelDescription }
      : {}),
  };
  if (typeof reference.value === "string") {
    return {
      ...common,
      value: { kind: "text", text: reference.value },
    };
  }
  if (reference.value instanceof vscode.Location) {
    return {
      ...common,
      value: {
        kind: "location",
        uri: reference.value.uri.toString(),
        range: toRange(reference.value.range),
      },
    };
  }
  if (reference.value instanceof vscode.Uri) {
    return {
      ...common,
      value: { kind: "uri", uri: reference.value.toString() },
    };
  }
  return {
    ...common,
    value: { kind: "unsupported" },
  };
}

export const vscodeReferenceResourceReader: ReferenceResourceReader = {
  async read(uriText: string, range?: ReferenceRange): Promise<string> {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(uriText)
    );
    if (!range) {
      return document.getText();
    }
    const requested = new vscode.Range(
      new vscode.Position(range.start.line, range.start.character),
      new vscode.Position(range.end.line, range.end.character)
    );
    const validated = document.validateRange(requested);
    if (!validated.isEqual(requested)) {
      throw new Error("the attached selection is outside the current document");
    }
    return document.getText(requested);
  },
};
