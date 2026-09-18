/**
 * Phase 10 release preparation: the onboarding notice must explain the
 * participant-only history limitation before first use, and must only be
 * shown once (or when explicitly reopened), matching the exit criterion
 * "known limitations are visible before first use".
 */
import * as assert from "assert";
import { getOnboardingMessage, shouldShowOnboarding } from "../src/onboardingMessage";

describe("onboarding (Phase 10)", () => {
  it("explains the participant-only history limitation", () => {
    const message = getOnboardingMessage();
    assert.ok(
      /only messages explicitly addressed to @roadmap/i.test(message),
      "onboarding message must explain that only @roadmap-addressed turns can be captured"
    );
    assert.ok(/@roadmap/.test(message), "onboarding message must mention @roadmap by name");
  });

  it("shows the notice on first run when the setting is enabled", () => {
    assert.strictEqual(shouldShowOnboarding(/* alreadyShown */ false, /* settingEnabled */ true), true);
  });

  it("does not show the notice again once already shown", () => {
    assert.strictEqual(shouldShowOnboarding(/* alreadyShown */ true, /* settingEnabled */ true), false);
  });

  it("does not show the notice when disabled via settings, even on first run", () => {
    assert.strictEqual(shouldShowOnboarding(/* alreadyShown */ false, /* settingEnabled */ false), false);
  });

  it("does not show the notice when both already shown and disabled", () => {
    assert.strictEqual(shouldShowOnboarding(/* alreadyShown */ true, /* settingEnabled */ false), false);
  });
});
