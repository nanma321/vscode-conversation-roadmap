/**
 * Webview bundle entry point. Reads the initial `roadmap`/`turns` state the
 * extension host injected inline (see `webviewPanel.ts#renderHtml`) and
 * mounts the React app. Live updates after this point arrive exclusively
 * via `postMessage` (`state`/`error`), handled inside {@link App}.
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { App, InitialState } from "./App";
import { getVsCodeApi } from "./vscodeApi";
import "./styles.css";

declare global {
  interface Window {
    __ROADMAP_INITIAL_STATE__?: InitialState;
  }
}

const container = document.getElementById("root");
const initialState = window.__ROADMAP_INITIAL_STATE__;

if (container && initialState) {
  const root = createRoot(container);
  root.render(<App vscode={getVsCodeApi()} initialState={initialState} />);
} else if (container) {
  container.textContent = "Unable to load the roadmap graph: no initial state was provided.";
}
