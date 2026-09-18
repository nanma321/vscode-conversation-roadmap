import * as assert from "assert";
import { previewTags } from "../../src/webview/tagDisplay";

describe("previewTags", () => {
  it("shows the first three tags and reports the hidden remainder by default", () => {
    assert.deepStrictEqual(previewTags(["one", "two", "three", "four", "five"]), {
      visible: ["one", "two", "three"],
      hidden: ["four", "five"],
    });
  });

  it("keeps a short tag list unchanged", () => {
    assert.deepStrictEqual(previewTags(["one", "two"]), {
      visible: ["one", "two"],
      hidden: [],
    });
  });

  it("supports an explicit non-negative display limit", () => {
    assert.deepStrictEqual(previewTags(["one", "two"], 0), {
      visible: [],
      hidden: ["one", "two"],
    });
  });

  it("never mutates the complete persisted tag list", () => {
    const tags = ["one", "two", "three", "four"];
    previewTags(tags);
    assert.deepStrictEqual(tags, ["one", "two", "three", "four"]);
  });
});
