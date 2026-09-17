import * as assert from "assert";
import {
  DEFAULT_NODE_BACKGROUND_FALLBACK,
  DEFAULT_NODE_FOREGROUND_FALLBACK,
  NODE_COLOR_SWATCHES,
  contrastRatio,
  contrastingTextColor,
} from "../../src/webview/nodeColor";

const MAS_MINIMUM_CONTRAST = 4.5;

describe("node color contrast", () => {
  it("meets MAS 1.4.3 for the fixed default node fallbacks", () => {
    assert.ok(
      contrastRatio(DEFAULT_NODE_BACKGROUND_FALLBACK, DEFAULT_NODE_FOREGROUND_FALLBACK) >=
        MAS_MINIMUM_CONTRAST
    );
  });

  it("chooses MAS-compliant text for every built-in node color", () => {
    for (const background of NODE_COLOR_SWATCHES) {
      const foreground = contrastingTextColor(background);
      assert.ok(
        contrastRatio(background, foreground) >= MAS_MINIMUM_CONTRAST,
        `${foreground} did not meet ${MAS_MINIMUM_CONTRAST}:1 against ${background}`
      );
    }
  });

  it("chooses MAS-compliant text across a representative RGB color grid", () => {
    for (let red = 0; red <= 255; red += 17) {
      for (let green = 0; green <= 255; green += 17) {
        for (let blue = 0; blue <= 255; blue += 17) {
          const background = `#${red.toString(16).padStart(2, "0")}${green
            .toString(16)
            .padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
          const foreground = contrastingTextColor(background);
          assert.ok(contrastRatio(background, foreground) >= MAS_MINIMUM_CONTRAST);
        }
      }
    }
  });

  it("supports compact three-digit colors", () => {
    assert.ok(contrastRatio("#abc", contrastingTextColor("#abc")) >= MAS_MINIMUM_CONTRAST);
  });
});
