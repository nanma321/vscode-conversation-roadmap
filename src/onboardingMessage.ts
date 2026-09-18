/**
 * Pure onboarding logic and message text, kept free of `vscode` so both are
 * unit-testable without an extension host (mirrors `resume/resumeContext.ts`).
 * See `onboarding.ts` for the `vscode`-facing wiring that uses these.
 */

/** The onboarding message body explaining the participant-only history limitation. */
export function getOnboardingMessage(): string {
  return (
    "Conversation Roadmap turns your chats with @roadmap into an editable graph. " +
    "Known limitation: only messages explicitly addressed to @roadmap can be captured - " +
    "VS Code's chat API never exposes turns sent to other participants or to unscoped chat, " +
    "so history from before you start using @roadmap, or from other participants, will not appear on the roadmap."
  );
}

/**
 * Decides whether the onboarding notice should be shown, given whether it has
 * already been shown before and whether the user has disabled it via the
 * `conversationRoadmap.showOnboarding` setting.
 */
export function shouldShowOnboarding(alreadyShown: boolean, settingEnabled: boolean): boolean {
  return settingEnabled && !alreadyShown;
}
