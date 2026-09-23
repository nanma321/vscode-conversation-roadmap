import * as assert from "assert";
import {
  AttachedReferenceGroup,
  buildReferenceContext,
  ReferenceRange,
  ReferenceResourceReader,
} from "../src/referenceContext";

function reader(
  implementation: (uri: string, range?: ReferenceRange) => Promise<string>
): ReferenceResourceReader {
  return { read: implementation };
}

describe("attached reference context", () => {
  it("includes attached text without reading any resource", async () => {
    let reads = 0;
    const result = await buildReferenceContext(
      [
        {
          origin: "current request",
          references: [
            {
              id: "inline",
              description: "pasted log",
              value: { kind: "text", text: "ERROR connection reset" },
            },
          ],
        },
      ],
      reader(async () => {
        reads += 1;
        return "";
      })
    );

    assert.strictEqual(reads, 0);
    assert.ok(result.context.includes("ERROR connection reset"));
    assert.ok(result.context.includes("Origin: current request"));
    assert.strictEqual(result.issues.length, 0);
  });

  it("reads only the explicitly attached URI", async () => {
    const reads: Array<{ uri: string; range?: ReferenceRange }> = [];
    const result = await buildReferenceContext(
      [
        {
          origin: "current request",
          references: [
            {
              id: "file",
              value: { kind: "uri", uri: "file:///attached/log.txt" },
            },
          ],
        },
      ],
      reader(async (uri, range) => {
        reads.push({ uri, range });
        return "attached file contents";
      })
    );

    assert.deepStrictEqual(reads, [
      { uri: "file:///attached/log.txt", range: undefined },
    ]);
    assert.ok(result.context.includes("attached file contents"));
  });

  it("applies the exact attached location range", async () => {
    const selection: ReferenceRange = {
      start: { line: 4, character: 2 },
      end: { line: 7, character: 9 },
    };
    let receivedRange: ReferenceRange | undefined;
    const result = await buildReferenceContext(
      [
        {
          origin: "current request",
          references: [
            {
              id: "selection",
              value: {
                kind: "location",
                uri: "file:///attached/analyzer.ts",
                range: selection,
              },
            },
          ],
        },
      ],
      reader(async (_uri, range) => {
        receivedRange = range;
        return "selected analyzer code";
      })
    );

    assert.deepStrictEqual(receivedRange, selection);
    assert.ok(result.context.includes("selected analyzer code"));
  });

  it("reports unreadable and unsupported references without inventing content", async () => {
    const result = await buildReferenceContext(
      [
        {
          origin: "current request",
          references: [
            {
              id: "missing-file",
              value: { kind: "uri", uri: "file:///missing.txt" },
            },
            {
              id: "future-reference",
              value: { kind: "unsupported" },
            },
          ],
        },
      ],
      reader(async () => {
        throw new Error("resource does not exist");
      })
    );

    assert.ok(result.context.includes("attached resource could not be read"));
    assert.ok(result.context.includes("reference type is not supported"));
    assert.ok(result.issues.some((issue) => issue.includes("resource does not exist")));
    assert.ok(result.issues.some((issue) => issue.includes("unsupported")));
    assert.ok(!result.context.includes("resource does not exist"));
  });

  it("prioritizes current then newest historical references within the total budget", async () => {
    const groups: AttachedReferenceGroup[] = [
      {
        origin: "current request",
        references: [
          { id: "current", value: { kind: "text", text: "CURRENT-" + "c".repeat(80) } },
        ],
      },
      {
        origin: "newest earlier request",
        references: [
          { id: "newest", value: { kind: "text", text: "NEWEST-" + "n".repeat(80) } },
        ],
      },
      {
        origin: "oldest earlier request",
        references: [
          { id: "oldest", value: { kind: "text", text: "OLDEST-" + "o".repeat(80) } },
        ],
      },
    ];
    const result = await buildReferenceContext(
      groups,
      reader(async () => ""),
      { maxPerReferenceCharacters: 100, maxTotalCharacters: 650 }
    );

    assert.ok(result.context.includes("CURRENT-"));
    assert.ok(result.context.includes("NEWEST-"));
    assert.ok(!result.context.includes("OLDEST-"));
    assert.strictEqual(result.omittedReferences, 1);
    assert.ok(result.context.length <= 650);
  });

  it("deduplicates the same reference across current and historical requests", async () => {
    let reads = 0;
    const same = {
      id: "same-file",
      value: { kind: "uri" as const, uri: "file:///attached/same.ts" },
    };
    const result = await buildReferenceContext(
      [
        { origin: "current request", references: [same] },
        { origin: "earlier request", references: [same] },
      ],
      reader(async () => {
        reads += 1;
        return "same content";
      })
    );

    assert.strictEqual(reads, 1);
    assert.strictEqual(result.includedReferences, 1);
  });

  it("enforces per-reference and aggregate size limits", async () => {
    const result = await buildReferenceContext(
      [
        {
          origin: "current request",
          references: [
            {
              id: "huge",
              value: { kind: "text", text: "x".repeat(2000) },
            },
            {
              id: "second",
              value: { kind: "text", text: "y".repeat(2000) },
            },
          ],
        },
      ],
      reader(async () => ""),
      { maxPerReferenceCharacters: 200, maxTotalCharacters: 700 }
    );

    assert.ok(result.context.length <= 700);
    assert.ok(result.truncatedReferences > 0);
    assert.ok(result.context.includes("attached content truncated"));
  });

  it("does nothing when no references are attached", async () => {
    let reads = 0;
    const result = await buildReferenceContext(
      [],
      reader(async () => {
        reads += 1;
        return "unexpected";
      })
    );

    assert.strictEqual(reads, 0);
    assert.strictEqual(result.context, "");
    assert.deepStrictEqual(result.issues, []);
  });
});
