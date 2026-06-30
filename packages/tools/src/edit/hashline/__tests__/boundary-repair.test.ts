import { describe, expect, it } from "vite-plus/test";
import { InMemorySnapshotStore } from "../../../lib/hashline-utils/snapshots";
import { applyEdits } from "../apply";
import { parsePatch } from "../parser";
import { Recovery } from "../recovery";

function apply(text: string, diff: string): { text: string; warnings: string[] } {
  const result = applyEdits(text, parsePatch(diff).edits);
  return { text: result.text, warnings: result.warnings ?? [] };
}

describe("boundary-balance repair", () => {
  it("drops a duplicated multi-line closing block (the Root.tsx incident)", () => {
    const file = [
      'import type React from "react";',
      'import { Composition } from "remotion";',
      'import { Sizzle, type SizzleProps } from "./compositions/Sizzle";',
      'import { FPS, totalDurationInFrames } from "./lib/scenes";',
      "",
      "export const RemotionRoot: React.FC = () => {",
      "\tconst durationInFrames = totalDurationInFrames();",
      "\treturn (",
      "\t\t<>",
      "\t\t\t<Composition",
      '\t\t\t\tid="Sizzle"',
      "\t\t\t\tcomponent={Sizzle}",
      "\t\t\t\tdurationInFrames={durationInFrames}",
      "\t\t\t\twidth={1920}",
      '\t\t\t\tdefaultProps={{ layout: "landscape" }}',
      "\t\t\t/>",
      "\t\t</>",
      "\t);",
      "};",
    ].join("\n");
    const diff = [
      "SWAP 7.=16:",
      "+\treturn (",
      "+\t\t<>",
      "+\t\t\t<Composition",
      '+\t\t\t\tid="Sizzle"',
      "+\t\t\t\tcomponent={Sizzle}",
      "+\t\t\t\tdurationInFrames={durationInFrames}",
      "+\t\t\t\twidth={1920}",
      '+\t\t\t\tdefaultProps={{ layout: "landscape" } satisfies SizzleProps}',
      "+\t\t\t/>",
      "+\t\t</>",
      "+\t);",
    ].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text.split("\n").filter((l) => l.trim() === "</>")).toHaveLength(1);
    expect(text.split("\n").filter((l) => l.trim() === ");")).toHaveLength(1);
    expect(text.endsWith("\t\t</>\n\t);\n};")).toBe(true);
    expect(warnings.some((w) => /delimiter-balance/.test(w))).toBe(true);
  });

  it("drops a single duplicated structural closer (`});`)", () => {
    const file = ["it('a', () => {", "\tsetup();", "\trun();", "});", "after();"].join("\n");
    const diff = ["SWAP 2.=3:", "+\tsetup2();", "+\trun2();", "+});"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      ["it('a', () => {", "\tsetup2();", "\trun2();", "});", "after();"].join("\n"),
    );
    expect(warnings.some((w) => /delimiter-balance/.test(w))).toBe(true);
  });

  it("drops a single duplicated structural opener (`planRender(`)", () => {
    const file = [
      "class Foo {",
      "\t/** doc */",
      "\tplanRender(",
      "\t\ta: string[],",
      "\t\tb: boolean,",
      "\t): Intent {",
      "\t\treturn x;",
      "\t}",
      "}",
    ].join("\n");
    const diff = [
      "SWAP 4.=6:",
      "+\tplanRender(",
      "+\t\ta: string[],",
      "+\t\tb: boolean,",
      "+\t\tc: number,",
      "+\t): Intent {",
    ].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      [
        "class Foo {",
        "\t/** doc */",
        "\tplanRender(",
        "\t\ta: string[],",
        "\t\tb: boolean,",
        "\t\tc: number,",
        "\t): Intent {",
        "\t\treturn x;",
        "\t}",
        "}",
      ].join("\n"),
    );
    expect(text.split("\n").filter((line) => line === "\tplanRender(")).toHaveLength(1);
    expect(warnings.some((w) => /delimiter-balance/.test(w))).toBe(true);
  });

  it("preserves a duplicated opener when it does not account for the imbalance", () => {
    const file = ["if (a) {", "\tfoo();", "}", "bar();"].join("\n");
    const diff = ["SWAP 2.=2:", "+if (a) {", "+\tif (b) {", "+\t\tfoo();"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      ["if (a) {", "if (a) {", "\tif (b) {", "\t\tfoo();", "}", "bar();"].join("\n"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("spares the deleted closing line when the payload omits it", () => {
    const file = ["const handlers = {", "\ta() {", "\t\treturn 1;", "\t},", "};"].join("\n");
    const diff = ["SWAP 5.=5:", "+\tb() {", "+\t\treturn 2;", "+\t},"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      [
        "const handlers = {",
        "\ta() {",
        "\t\treturn 1;",
        "\t},",
        "\tb() {",
        "\t\treturn 2;",
        "\t},",
        "};",
      ].join("\n"),
    );
    expect(warnings.some((w) => /delimiter-balance/.test(w))).toBe(true);
  });

  it("does not spare a deleted closing line that the payload already restates", () => {
    const file = ["class Foo {", "\tok();", "\t}", "}"].join("\n");
    const diff = ["SWAP 1.=4:", "+class Foo {", "+\tok();", "+}"].join("\n");
    const { text, warnings } = apply(file, diff);

    expect(text).toBe(["class Foo {", "\tok();", "}"].join("\n"));
    expect(text.split("\n").filter((line) => line === "}")).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it("drops duplicated leading and trailing boundary lines around a range replacement", () => {
    const file = [
      "func _cmd_travel_homeworld():",
      "\tvar destination = get_homeworld()",
      "\ttravel_to(destination)",
      "\tprint_status()",
    ].join("\n");
    const diff = [
      "SWAP 2.=3:",
      "+func _cmd_travel_homeworld():",
      "+\tvar destination = find_homeworld()",
      "+\ttravel_to(destination)",
      "+\tprint_status()",
    ].join("\n");

    const { text, warnings } = apply(file, diff);

    expect(text).toBe(
      [
        "func _cmd_travel_homeworld():",
        "\tvar destination = find_homeworld()",
        "\ttravel_to(destination)",
        "\tprint_status()",
      ].join("\n"),
    );
    expect(
      text.split("\n").filter((line) => line === "func _cmd_travel_homeworld():"),
    ).toHaveLength(1);
    expect(text.split("\n").filter((line) => line === "\tprint_status()")).toHaveLength(1);
    expect(warnings.some((warning) => /boundary echo/.test(warning))).toBe(true);
  });

  it("preserves payloads where multi-line boundary echoes cover every line", () => {
    const file = ["A", "B", "old", "C", "D"].join("\n");
    const diff = ["SWAP 3.=3:", "+A", "+B", "+C", "+D"].join("\n");

    const { text, warnings } = apply(file, diff);

    expect(text).toBe(["A", "B", "A", "B", "C", "D", "C", "D"].join("\n"));
    expect(warnings).toHaveLength(0);
  });

  it("preserves payloads made only of lines matching both replacement neighbors", () => {
    const file = ["a", "old", "c"].join("\n");
    const diff = ["SWAP 2.=2:", "+a", "+c"].join("\n");

    const { text, warnings } = apply(file, diff);

    expect(text).toBe(["a", "a", "c", "c"].join("\n"));
    expect(warnings).toHaveLength(0);
  });

  it("preserves balance-shifting boundary echoes that do not explain the delta", () => {
    const file = ["}", "old();", "}"].join("\n");
    const diff = ["SWAP 2.=2:", "+}", "+if (a) {", "+if (b) {", "+x();", "+}"].join("\n");

    const { text, warnings } = apply(file, diff);

    expect(text).toBe(["}", "}", "if (a) {", "if (b) {", "x();", "}", "}"].join("\n"));
    expect(warnings).toHaveLength(0);
  });

  it("still drops a balance-neutral wrapper echo", () => {
    const file = ["function f() {", "old();", "}"].join("\n");
    const diff = ["SWAP 2.=2:", "+function f() {", "+fresh();", "+}"].join("\n");

    const { text, warnings } = apply(file, diff);

    expect(text).toBe(["function f() {", "fresh();", "}"].join("\n"));
    expect(warnings.some((warning) => /boundary echo/.test(warning))).toBe(true);
  });

  it("leaves a balance-preserving replacement alone (no false positive)", () => {
    const file = ["foo();", "bar();", "bar();", "baz();"].join("\n");
    const diff = ["SWAP 2.=2:", "+qux();", "+bar();"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(["foo();", "qux();", "bar();", "bar();", "baz();"].join("\n"));
    expect(warnings).toHaveLength(0);
  });

  it("does not drop a balance-neutral duplicated statement", () => {
    const file = ["a = 1;", "b = 2;", "c = 3;"].join("\n");
    const diff = ["SWAP 1.=1:", "+a = 1;", "+b = 2;"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(["a = 1;", "b = 2;", "b = 2;", "c = 3;"].join("\n"));
    expect(warnings).toHaveLength(0);
  });

  it("ignores brackets inside string literals", () => {
    const file = ['const a = "}";', 'const b = "x";', 'const c = "y";'].join("\n");
    const diff = ["SWAP 2.=2:", '+const b = "}}}";'].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(['const a = "}";', 'const b = "}}}";', 'const c = "y";'].join("\n"));
    expect(warnings).toHaveLength(0);
  });

  it("drops a one-sided trailing keeper echo in a multi-line rewrite", () => {
    const file = [
      "function f() {",
      "  a();",
      "  b();",
      "  const out = [];",
      "  return out;",
      "}",
    ].join("\n");
    const diff = ["SWAP 2.=3:", "+  a2();", "+  b2();", "+  const out = [];"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      ["function f() {", "  a2();", "  b2();", "  const out = [];", "  return out;", "}"].join(
        "\n",
      ),
    );
    expect(warnings.some((warning) => /boundary echo/.test(warning))).toBe(true);
  });

  it("drops a one-sided JSX closer echo in a single-line expansion", () => {
    const file = ["const view = (", "  <section>", "    <Old />", "  </section>", ");"].join("\n");
    const diff = ["SWAP 3.=3:", "+    <New />", "+  </section>"].join("\n");
    const { text, warnings } = apply(file, diff);

    expect(text).toBe(
      ["const view = (", "  <section>", "    <New />", "  </section>", ");"].join("\n"),
    );
    expect(text.split("\n").filter((line) => line === "  </section>")).toHaveLength(1);
    expect(warnings.some((warning) => /boundary echo/.test(warning))).toBe(true);
  });

  it("drops a JSX closer echo after a self-closing tag with a greater-than prop expression", () => {
    const file = ["const view = (", "<Foo>", "old text", "</Foo>", ");"].join("\n");
    const diff = ["SWAP 3.=3:", "+<Foo value={a > b} />", "+</Foo>"].join("\n");
    const { text, warnings } = apply(file, diff);

    expect(text).toBe(
      ["const view = (", "<Foo>", "<Foo value={a > b} />", "</Foo>", ");"].join("\n"),
    );
    expect(text.split("\n").filter((line) => line === "</Foo>")).toHaveLength(1);
    expect(warnings.some((warning) => /boundary echo/.test(warning))).toBe(true);
  });

  it("preserves a nested JSX closer that matches the surviving parent closer", () => {
    const file = [
      "const view = (",
      '<section className="outer">',
      "old text",
      "</section>",
      ");",
    ].join("\n");
    const diff = ["SWAP 3.=3:", "+<section>", "+new text", "+</section>"].join("\n");
    const { text, warnings } = apply(file, diff);

    expect(text).toBe(
      [
        "const view = (",
        '<section className="outer">',
        "<section>",
        "new text",
        "</section>",
        "</section>",
        ");",
      ].join("\n"),
    );
    expect(text.split("\n").filter((line) => line.trim() === "</section>")).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("preserves a nested JSX closer when the opener spans payload lines", () => {
    const file = [
      "const view = (",
      '<section className="outer">',
      "old text",
      "</section>",
      ");",
    ].join("\n");
    const diff = [
      "SWAP 3.=3:",
      "+<section",
      '+  className="inner"',
      "+>",
      "+new text",
      "+</section>",
    ].join("\n");
    const { text, warnings } = apply(file, diff);

    expect(text).toBe(
      [
        "const view = (",
        '<section className="outer">',
        "<section",
        '  className="inner"',
        ">",
        "new text",
        "</section>",
        "</section>",
        ");",
      ].join("\n"),
    );
    expect(text.split("\n").filter((line) => line.trim() === "</section>")).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("drops a one-sided leading keeper echo in a multi-line rewrite", () => {
    const file = ["setup();", "a();", "b();", "c();"].join("\n");
    const diff = ["SWAP 3.=4:", "+a();", "+B();", "+C();"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(["setup();", "a();", "B();", "C();"].join("\n"));
    expect(warnings.some((warning) => /boundary echo/.test(warning))).toBe(true);
  });

  it("does not keep a deleted closer when another hunk removes its opener (#3142)", () => {
    const file = ["if enabled {", '\tText("Old")', "}", '\tText("Tail")'].join("\n");
    const diff = ["DEL 1", "SWAP 2.=3:", '+Text("New")'].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(['Text("New")', '\tText("Tail")'].join("\n"));
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(0);
  });

  it("spends the missing-closer residual on the genuine hunk, not an earlier wrapper removal", () => {
    const file = ["if enabled {", '\tText("Old")', "}", "const config = {", "\ta: 1,", "};"].join(
      "\n",
    );
    const diff = ["DEL 1", "SWAP 2.=3:", '+Text("New")', "SWAP 6.=6:", "+\tb: 2,"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(['Text("New")', "const config = {", "\ta: 1,", "\tb: 2,", "};"].join("\n"));
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });

  it("keeps the closer when the matching opener is replaced rather than removed", () => {
    const file = ["if (a) {", "\told();", "}"].join("\n");
    const diff = ["SWAP 1.=1:", "+if (b) {", "SWAP 2.=3:", "+\tnew();"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(["if (b) {", "\tnew();", "}"].join("\n"));
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });

  it("does not keep deleted closer suffixes whose tail the payload already restates", () => {
    const file = [
      "const REASONING_LABEL_PATTERN = /think/i;",
      "const NO_REASONING_LABEL_PATTERN = /no/i;",
      "",
      "\treturn config.supportsThinking === true;",
      "}",
      "}",
    ].join("\n");
    const diff = [
      "SWAP 3.=6:",
      "+function supportsDevinThinking(config: ClientModelConfig): boolean {",
      "+\tif (NO_REASONING_LABEL_PATTERN.test(config.label)) return false;",
      "+\treturn config.supportsThinking === true;",
      "+}",
    ].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      [
        "const REASONING_LABEL_PATTERN = /think/i;",
        "const NO_REASONING_LABEL_PATTERN = /no/i;",
        "function supportsDevinThinking(config: ClientModelConfig): boolean {",
        "\tif (NO_REASONING_LABEL_PATTERN.test(config.label)) return false;",
        "\treturn config.supportsThinking === true;",
        "}",
      ].join("\n"),
    );
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(0);
  });

  it("keeps only the non-restated outer closer for a nested deleted suffix", () => {
    const file = ["class C {", "\told();", "\t}", "}"].join("\n");
    const diff = ["SWAP 2.=4:", "+\tnewMethod() {", "+\t\treturn 1;", "+\t}"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(["class C {", "\tnewMethod() {", "\t\treturn 1;", "\t}", "}"].join("\n"));
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });

  it("ignores non-contiguously deleted openers when choosing which closer to keep", () => {
    const file = ["if (a) {", "\told();", "\tmore();", "}", "const obj = {", "\ta: 1,", "};"].join(
      "\n",
    );
    const diff = ["DEL 1", "SWAP 3.=4:", "+\tnew();", "SWAP 7.=7:", "+\tb: 2,"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      ["\told();", "\tnew();", "const obj = {", "\ta: 1,", "\tb: 2,", "};"].join("\n"),
    );
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });

  it("counts earlier kept closers in later projected prefixes", () => {
    const file = [
      "if (a) {",
      "\told();",
      "}",
      "const NO_REASONING_LABEL_PATTERN = /no/i;",
      "\treturn config.supportsThinking === true;",
      "\t}",
    ].join("\n");
    const diff = [
      "SWAP 2.=3:",
      "+\tnew();",
      "SWAP 4.=6:",
      "+function supportsDevinThinking(config: ClientModelConfig): boolean {",
      "+\treturn config.supportsThinking === true;",
      "+}",
    ].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      [
        "if (a) {",
        "\tnew();",
        "}",
        "function supportsDevinThinking(config: ClientModelConfig): boolean {",
        "\treturn config.supportsThinking === true;",
        "}",
      ].join("\n"),
    );
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });

  it("does not let an earlier kept closer cover a later orphan closer", () => {
    const file = ["if (a) {", "\told();", "}", "}"].join("\n");
    const diff = ["SWAP 2.=3:", "+\tnew();", "SWAP 4.=4:", "+after();"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(["if (a) {", "\tnew();", "}", "after();"].join("\n"));
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });

  it("does not keep a deleted outer closer when one survives below the range", () => {
    const file = ["class C {", "\tmethod() {", "\t\told();", "\t}", "}", "}"].join("\n");
    const diff = ["SWAP 2.=5:", "+\tmethod() {", "+\t\tnew();", "+\t}"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(["class C {", "\tmethod() {", "\t\tnew();", "\t}", "}"].join("\n"));
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(0);
  });

  it("keeps an omitted inner closer when the outer closer survives below", () => {
    const file = ["class C {", "\tmethod() {", "\t\told();", "\t}", "}", "}"].join("\n");
    const diff = ["SWAP 2.=5:", "+\tmethod() {", "+\t\tnew();"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(["class C {", "\tmethod() {", "\t\tnew();", "\t}", "}"].join("\n"));
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });

  it("counts same-line inserted prefixes before replacement payload", () => {
    const file = ["\told();", "}"].join("\n");
    const diff = ["INS.PRE 1:", "+if (a) {", "SWAP 1.=2:", "+\tnew();"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(["if (a) {", "\tnew();", "}"].join("\n"));
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });

  it("counts a separately inserted closer immediately below the range", () => {
    const file = ["class C {", "\told();", "}", "after();", "const obj = {", "\ta: 1,", "};"].join(
      "\n",
    );
    const diff = ["SWAP 2.=3:", "+\tnew();", "INS.PRE 4:", "+}", "SWAP 7.=7:", "+\tb: 2,"].join(
      "\n",
    );
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      ["class C {", "\tnew();", "}", "after();", "const obj = {", "\ta: 1,", "\tb: 2,", "};"].join(
        "\n",
      ),
    );
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });

  it("keeps an omitted outer closer even when the payload restates an inner closer", () => {
    const file = ["if (a) {", "\tif (b) {", "\t\told();", "\t}", "}", "after();"].join("\n");
    const diff = ["SWAP 1.=5:", "+if (a) {", "+\tif (c) {", "+\t\tnew();", "+\t}"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(["if (a) {", "\tif (c) {", "\t\tnew();", "\t}", "}", "after();"].join("\n"));
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });

  it("still keeps a missing closer when another hunk's dupSuffix repair masks the raw delta", () => {
    const file = [
      'addEventListener("click", () => {',
      "\tfoo();",
      "\tbar();",
      "});",
      "",
      "const config = {",
      "\ta: 1,",
      "};",
    ].join("\n");
    const diff = [
      "SWAP 2.=3:",
      "+\tsetup();",
      "+\tfoo();",
      "+\tbar();",
      "+});",
      "SWAP 8.=8:",
      "+\tb: 2,",
    ].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      [
        'addEventListener("click", () => {',
        "\tsetup();",
        "\tfoo();",
        "\tbar();",
        "});",
        "",
        "const config = {",
        "\ta: 1,",
        "\tb: 2,",
        "};",
      ].join("\n"),
    );
    expect(warnings.some((warning) => /trailing payload line/.test(warning))).toBe(true);
    expect(warnings.some((warning) => /structural closing line/.test(warning))).toBe(true);
  });

  it("does not let an unterminated template in one hunk mask a missing closer in another", () => {
    const file = ["const log = makeLog(`", "prefix", "`);", "const obj = {", "\ta: 1", "};"].join(
      "\n",
    );
    const diff = ["SWAP 1.=1:", "+const log = createLog(`", "SWAP 5.=6:", "+\ta: 2"].join("\n");
    const { text, warnings } = apply(file, diff);
    expect(text).toBe(
      ["const log = createLog(`", "prefix", "`);", "const obj = {", "\ta: 2", "};"].join("\n"),
    );
    expect(warnings.filter((warning) => /structural closing line/.test(warning))).toHaveLength(1);
  });
});

describe("boundary-balance repair through stale-snapshot recovery", () => {
  const PATH = "/tmp/__hashline-boundary-recovery__.ts";

  it("de-duplicates a closer while recovering from a drifted file", () => {
    const snapshotLines = [
      'import { x } from "y";',
      "",
      "it('a', () => {",
      "\tsetup();",
      "\trun();",
      "});",
      "",
      "function filler1() { return 1; }",
      "function filler2() { return 2; }",
      "function filler3() { return 3; }",
      "function filler4() { return 4; }",
      "function filler5() { return 5; }",
      "const tail = 0;",
      "export { tail };",
    ];
    const snapshotText = `${snapshotLines.join("\n")}\n`;
    const currentText = snapshotText.replace("const tail = 0;", "const tail = 99;");

    const store = new InMemorySnapshotStore();
    const fileHash = store.record(PATH, snapshotText);

    const { edits } = parsePatch(["SWAP 4.=5:", "+\tsetup2();", "+\trun2();", "+});"].join("\n"));
    const recovered = new Recovery(store).tryRecover({
      path: PATH,
      currentText,
      fileHash,
      edits,
    });

    expect(recovered).not.toBeNull();
    expect(recovered?.text.split("\n").filter((l) => l === "});")).toHaveLength(1);
    expect(recovered?.text).toContain("setup2();");
    expect(recovered?.text).toContain("run2();");
    expect(recovered?.text).toContain("const tail = 99;");
    expect(recovered?.warnings.some((w) => /delimiter-balance/.test(w))).toBe(true);
  });
});
