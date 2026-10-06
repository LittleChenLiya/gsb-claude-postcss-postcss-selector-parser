import { execFileSync } from "node:child_process";
import path from "node:path";

// Keep the spawned CLI process out of the coverage session: node --test
// exports NODE_V8_COVERAGE to its children, and merging the grandchild
// coverage of dist/ corrupts the source-mapped line report.
const cliEnv = Object.assign({}, process.env);
delete cliEnv.NODE_V8_COVERAGE;
const cliOptions = { encoding: "utf8", env: cliEnv };
import test from "./util/runner.mjs";
import { analyzeSpecificity } from "../../dist/specificity.js";

const only = (input, options) => {
  const report = analyzeSpecificity(input, options);
  if (report.selectors.length !== 1) {
    throw new Error(`expected exactly one selector report for ${input}`);
  }
  return report.selectors[0];
};

test("specificity: :where(#x).a contributes only the class", (t) => {
  const report = only(":where(#x).a");
  t.true(report.supported);
  t.deepEqual(report.specificity, [0, 1, 0]);
  const id = report.contributions.find((entry) => entry.value === "#x");
  t.truthy(id);
  t.deepEqual(id.specificity, [0, 0, 0]);
  t.regex(id.reason, /:where\(\)/);
  const klass = report.contributions.find((entry) => entry.value === ".a");
  t.deepEqual(klass.specificity, [0, 1, 0]);
  const where = report.contributions.find((entry) => entry.node === "pseudo");
  t.deepEqual(where.specificity, [0, 0, 0]);
  t.deepEqual(where.arguments, [{ selector: "#x", specificity: [1, 0, 0] }]);
});

test("specificity: :is(.a,#b) takes the ID branch", (t) => {
  const report = only(":is(.a,#b)");
  t.true(report.supported);
  t.deepEqual(report.specificity, [1, 0, 0]);
  const pseudo = report.contributions.find((entry) => entry.node === "pseudo");
  t.deepEqual(pseudo.specificity, [1, 0, 0]);
  t.deepEqual(pseudo.arguments, [
    { selector: ".a", specificity: [0, 1, 0] },
    { selector: "#b", specificity: [1, 0, 0] },
  ]);
});

test("specificity: :not() and :has() follow the same max-of-arguments rule", (t) => {
  t.deepEqual(only(":not(.a, #b)").specificity, [1, 0, 0]);
  t.deepEqual(only(":has(> .a)").specificity, [0, 1, 0]);
  t.deepEqual(only("div:has(span, #x)").specificity, [1, 0, 1]);
});

test("specificity: mixed complex selector accumulates per node", (t) => {
  const report = only("ul#nav li.active a:hover::before");
  t.true(report.supported);
  t.deepEqual(report.specificity, [1, 2, 4]);
  // every contribution is traceable to a source position in the input
  report.contributions.forEach((entry) => {
    t.is(typeof entry.sourceIndex, "number");
    t.truthy(entry.reason);
  });
  const before = report.contributions.find((entry) => entry.value === "::before");
  t.deepEqual(before.specificity, [0, 0, 1]);
});

test("specificity: selector lists are reported individually, never merged", (t) => {
  const report = analyzeSpecificity("#a, .b, span");
  t.is(report.selectors.length, 3);
  t.deepEqual(report.selectors[0].specificity, [1, 0, 0]);
  t.deepEqual(report.selectors[1].specificity, [0, 1, 0]);
  t.deepEqual(report.selectors[2].specificity, [0, 0, 1]);
  t.false("specificity" in report);
  t.deepEqual(
    report.selectors.map((entry) => entry.selector),
    ["#a", ".b", "span"],
  );
});

test("specificity: unknown pseudo-class is unsupported and yields no total", (t) => {
  const report = only(".b > :unknown-pseudo");
  t.false(report.supported);
  t.is(report.specificity, null);
  t.is(report.unsupported.length, 1);
  t.is(report.unsupported[0].value, ":unknown-pseudo");
  t.regex(report.unsupported[0].reason, /unknown pseudo-class/);
  // known nodes are still reported with their own contributions
  const klass = report.contributions.find((entry) => entry.value === ".b");
  t.deepEqual(klass.specificity, [0, 1, 0]);
});

test("specificity: unknown pseudo-element is unsupported and yields no total", (t) => {
  const report = only("p::made-up");
  t.false(report.supported);
  t.is(report.specificity, null);
  t.regex(report.unsupported[0].reason, /unknown pseudo-element/);
});

test("specificity: unknown pseudo inside :is() poisons the total", (t) => {
  const report = only(":is(.a, :bogus)");
  t.false(report.supported);
  t.is(report.specificity, null);
  t.regex(report.unsupported[0].reason, /unknown pseudo-class/);
});

test("specificity: legacy and double-colon pseudo-elements count as types", (t) => {
  t.deepEqual(only("p:after").specificity, [0, 0, 2]);
  t.deepEqual(only("p::selection").specificity, [0, 0, 2]);
});

test("specificity: universal, combinators and attributes", (t) => {
  const report = only("* > [data-x] + span");
  t.true(report.supported);
  t.deepEqual(report.specificity, [0, 1, 1]);
  const universal = report.contributions.find((entry) => entry.node === "universal");
  t.deepEqual(universal.specificity, [0, 0, 0]);
  const combinators = report.contributions.filter((entry) => entry.node === "combinator");
  t.is(combinators.length, 2);
  combinators.forEach((entry) => t.deepEqual(entry.specificity, [0, 0, 0]));
});

test("specificity: nesting selector requires an explicit parent selector", (t) => {
  const report = only("& .child");
  t.false(report.supported);
  t.is(report.specificity, null);
  t.regex(report.unsupported[0].reason, /parentSelector/);
});

test("specificity: nesting selector resolves via explicitly passed parent", (t) => {
  const report = only("& .child", { parentSelector: "#p .q" });
  t.true(report.supported);
  t.deepEqual(report.specificity, [1, 2, 0]);
  const nesting = report.contributions.find((entry) => entry.node === "nesting");
  t.deepEqual(nesting.specificity, [1, 1, 0]);
  t.deepEqual(nesting.arguments, [{ selector: "#p .q", specificity: [1, 1, 0] }]);
});

test("specificity: nesting parent list uses the most specific member", (t) => {
  const report = only("&", { parentSelector: ".low, #high" });
  t.true(report.supported);
  t.deepEqual(report.specificity, [1, 0, 0]);
});

test("specificity: unsupported parent selector propagates", (t) => {
  const report = only("&", { parentSelector: ":bogus-parent" });
  t.false(report.supported);
  t.is(report.specificity, null);
  t.regex(report.unsupported[0].reason, /parent selector/);
});

test("specificity: empty parentSelector option is treated as missing", (t) => {
  const report = only("&", { parentSelector: "  " });
  t.false(report.supported);
  t.is(report.specificity, null);
});

test("specificity: ::slotted() adds its most specific argument", (t) => {
  const report = only("::slotted(span, #x)");
  t.true(report.supported);
  t.deepEqual(report.specificity, [1, 0, 1]);
});

test("specificity: functional pseudo-classes with non-selector arguments", (t) => {
  t.deepEqual(only("li:nth-child(2n + 1)").specificity, [0, 1, 1]);
  t.deepEqual(only(":lang(en)").specificity, [0, 1, 0]);
});

test("specificity: invalid input throws", (t) => {
  t.throws(() => analyzeSpecificity(""), { message: /non-empty selector string/ });
  t.throws(() => analyzeSpecificity(null), { message: /non-empty selector string/ });
});

test("specificity: CLI runs the four examples", (t) => {
  const bin = path.join(process.cwd(), "bin", "specificity.js");
  const output = execFileSync(process.execPath, [bin, "--examples"], cliOptions);
  t.regex(output, /Example 1: :where\(#x\)\.a/);
  t.regex(output, /Example 2: :is\(\.a,#b\)/);
  t.regex(output, /Example 3: ul#nav li\.active a:hover::before/);
  t.regex(output, /Example 4: #a, \.b > :unknown-pseudo, & \.child/);
});

test("specificity: CLI reports a selector list individually", (t) => {
  const bin = path.join(process.cwd(), "bin", "specificity.js");
  const output = execFileSync(process.execPath, [bin, ":where(#x).a"], cliOptions);
  const report = JSON.parse(output);
  t.is(report.selectors.length, 1);
  t.deepEqual(report.selectors[0].specificity, [0, 1, 0]);
});

test("specificity: CLI resolves '&' only with --parent-selector", (t) => {
  const bin = path.join(process.cwd(), "bin", "specificity.js");
  const withoutParent = JSON.parse(execFileSync(process.execPath, [bin, "& .a"], cliOptions));
  t.false(withoutParent.selectors[0].supported);
  t.is(withoutParent.selectors[0].specificity, null);
  const withParent = JSON.parse(
    execFileSync(process.execPath, [bin, "--parent-selector", "#p", "& .a"], cliOptions),
  );
  t.true(withParent.selectors[0].supported);
  t.deepEqual(withParent.selectors[0].specificity, [1, 1, 0]);
});

test("specificity: string nodes inside arguments contribute zero", (t) => {
  const report = only(':is("x")');
  t.true(report.supported);
  t.deepEqual(report.specificity, [0, 0, 0]);
});

test("specificity: comments are ignored without a contribution entry", (t) => {
  const report = only(".a/*c*/#b");
  t.true(report.supported);
  t.deepEqual(report.specificity, [1, 1, 0]);
  t.false(report.contributions.some((entry) => entry.node === "comment"));
});

test("specificity: equally specific arguments keep the first branch", (t) => {
  const report = only(":is(.a, .b)");
  t.true(report.supported);
  t.deepEqual(report.specificity, [0, 1, 0]);
  const pseudo = report.contributions.find((entry) => entry.node === "pseudo");
  t.deepEqual(pseudo.arguments, [
    { selector: ".a", specificity: [0, 1, 0] },
    { selector: ".b", specificity: [0, 1, 0] },
  ]);
});
