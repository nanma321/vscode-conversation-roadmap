/**
 * Thin typed wrapper around the `acquireVsCodeApi()` global VS Code injects
 * into every Webview. Kept in its own module so the rest of the Webview
 * source only ever imports a typed {@link VsCodeApi}, never the ambient
 * global directly.
 */
import type { WebviewToHostMessage } from "../webviewMessages";

export interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cached: VsCodeApi | undefined;

/** Returns the singleton VS Code API handle, acquiring it on first use (it may only be acquired once per Webview). */
export function getVsCodeApi(): VsCodeApi {
  if (!cached) {
    cached = acquireVsCodeApi();
  }
  return cached;
}
