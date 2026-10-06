import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSelectorList } from "./specificity.mjs";

function only(input, options) {
  const report = analyzeSelectorList(input, options);
  assert.equal(report.selectors.length, 1, "expected a single complex selector");
  return report.selectors[0];
}

test(":where(#x).a contributes only the class", () => {
  const sel = only(":where(#x).a");
  assert.deepEqual(sel.specificity, [0, 1, 0]);
  const where = sel.contributions.find((c) => c.type === "pseudo");
  assert.deepEqual(where.specificity, [0, 0, 0]);
  const klass = sel.contributions.find((c) => c.type === "class");
  assert.deepEqual(klass.specificity, [0, 1, 0]);
});

test(":is(.a,#b) takes the ID branch and the source is traceable", () => {
  const sel = only(":is(.a,#b)");
  assert.deepEqual(sel.specificity, [1, 0, 0]);
  const pseudo = sel.contributions[0];
  assert.equal(pseudo.source, "#b");
  assert.deepEqual(
    pseudo.arguments.map((a) => [a.argument, a.specificity]),
    [
      [".a", [0, 1, 0]],
      ["#b", [1, 0, 0]],
    ],
  );
});

test(":not() and :has() follow the same most-specific-argument rule", () => {
  assert.deepEqual(only("p:not(.x, #y)").specificity, [1, 0, 1]);
  assert.deepEqual(only(":has(> img)").specificity, [0, 0, 1]);
  assert.deepEqual(only(":not(:where(#a, .b))").specificity, [0, 0, 0]);
});

test("selector lists are reported per selector, never merged", () => {
  const report = analyzeSelectorList("#a, .b[href] span");
  assert.equal(report.selectors.length, 2);
  assert.deepEqual(report.selectors[0].specificity, [1, 0, 0]);
  assert.deepEqual(report.selectors[1].specificity, [0, 2, 1]);
});

test("unknown pseudo-classes are unsupported and yield no fake total", () => {
  const sel = only("div:made-up-pseudo");
  assert.equal(sel.specificity, null);
  assert.equal(sel.unsupported.length, 1);
  assert.match(sel.unsupported[0].reason, /unknown pseudo-class/);
  // the known part is still reported per node
  const tag = sel.contributions.find((c) => c.type === "tag");
  assert.deepEqual(tag.specificity, [0, 0, 1]);
});

test("unknown functional pseudo-classes are unsupported", () => {
  const sel = only("div:vendor-thing(.a)");
  assert.equal(sel.specificity, null);
  assert.match(sel.unsupported[0].reason, /unknown functional pseudo-class/);
});

test("nesting selector requires an explicitly passed parent", () => {
  const bare = only("& .a");
  assert.equal(bare.specificity, null);
  assert.match(bare.unsupported[0].reason, /parent selector/);

  const resolved = only("& .a", { parent: "#p, .q" });
  assert.deepEqual(resolved.specificity, [1, 1, 0]);
  const nesting = resolved.contributions.find((c) => c.type === "nesting");
  assert.equal(nesting.source, "#p");
});

test("compound, combinators, pseudo-elements and attributes", () => {
  assert.deepEqual(only("nav > .item:hover::after").specificity, [0, 2, 2]);
  assert.deepEqual(only("ul#nav li.active a[href]").specificity, [1, 2, 3]);
  assert.deepEqual(only("*").specificity, [0, 0, 0]);
  assert.deepEqual(only("p:first-line").specificity, [0, 0, 2]);
});

test(":nth-child(An+B of S) adds the most specific selector of S", () => {
  assert.deepEqual(only("li:nth-child(2n of .a, #b)").specificity, [1, 1, 1]);
  assert.deepEqual(only("li:nth-child(3)").specificity, [0, 1, 1]);
});

test("unsupported argument inside :is() poisons the total, not the report", () => {
  const sel = only(":is(.a, :unknown-fn(#x))");
  assert.equal(sel.specificity, null);
  assert.ok(sel.unsupported.length > 0);
});
