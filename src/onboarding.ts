/**
 * Phase 10 release preparation: a first-run onboarding notice that explains
 * the Phase 1 participant-only history limitation before a user captures
 * their first turn - "known limitations are visible before first use" is a
 * Phase 10 exit criterion.
 *
 * The limitation itself is inherent to the public `vscode.chat` API: a chat
 * participant's handler only ever receives requests explicitly addressed to
 * it (see `chatParticipant.ts`), so `@roadmap` can never see, and therefore
 * can never capture, turns sent to other participants or to unscoped chat.
 * This module only surfaces that constraint to the user; it does not change
 * capture behavior.
 *
 * The message text and show/hide decision live in the `vscode`-free
 * `onboardingMessage.ts` so they stay unit-testable without an extension
 * host; this file only wires that logic to `vscode` (notifications,
 * `globalState`, and the `conversationRoadmap.showOnboarding` setting).
 */
import * as vscode from "vscode";
import { getOnboardingMessage, shouldShowOnboarding } from "./onboardingMessage";

/** `globalState` key recording that onboarding has already been shown once. */
export const ONBOARDING_SHOWN_KEY = "conversationRoadmap.onboardingShown";

/** Configuration key controlling whether the onboarding notice may be shown at all. */
export const SHOW_ONBOARDING_SETTING = "conversationRoadmap.showOnboarding";

/** Label of the action that reopens the graph from the onboarding notice. */
export const OPEN_GRAPH_ACTION = "Open Graph";
/** Label of the action that opens the troubleshooting/user documentation. */
export const LEARN_MORE_ACTION = "Learn More";

/**
 * Shows the onboarding notice once per install (tracked in `globalState`),
 * unless the user disabled it via `conversationRoadmap.showOnboarding`.
 * Reused by the "Conversation Roadmap: Show Onboarding" command to let a user reopen it
 * on demand, in which case `force` bypasses the "already shown" check.
 */
export async function maybeShowOnboarding(
  context: vscode.ExtensionContext,
  force = false
): Promise<void> {
  const settingEnabled = vscode.workspace.getConfiguration().get<boolean>(SHOW_ONBOARDING_SETTING, true);
  const alreadyShown = context.globalState.get<boolean>(ONBOARDING_SHOWN_KEY, false);
  if (!force && !shouldShowOnboarding(alreadyShown, settingEnabled)) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    getOnboardingMessage(),
    OPEN_GRAPH_ACTION,
    LEARN_MORE_ACTION
  );
  await context.globalState.update(ONBOARDING_SHOWN_KEY, true);

  if (choice === OPEN_GRAPH_ACTION) {
    await vscode.commands.executeCommand("conversationRoadmap.openGraph");
  } else if (choice === LEARN_MORE_ACTION) {
    await vscode.env.openExternal(
      vscode.Uri.joinPath(context.extensionUri, "docs", "TROUBLESHOOTING.md")
    );
  }
}
