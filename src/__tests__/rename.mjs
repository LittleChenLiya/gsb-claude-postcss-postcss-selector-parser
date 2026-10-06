import parser from "../../dist/index.js";
import test from "./util/runner.mjs";

const { applyRenamePlan, planRenames, RenameConflictError } = parser;

const rename = (input, plan) => {
  const root = parser().astSync(input);
  const result = applyRenamePlan(root, plan);
  return { output: root.toString(), result, root };
};

// Example 1: a plain class and an escaped spelling of the same name are
// renamed together (matching compares semantic, unescaped values).
test("rename: .a and escaped .\\61 are renamed together", (t) => {
  const { output, result } = rename(".a, .\\61", { classes: { a: "b" } });
  t.is(output, ".b, .b");
  t.deepEqual(result, { classes: 2, ids: 0 });
});

// Example 2: attribute strings are not selector class nodes and stay put,
// while an actual class node in the same selector is renamed.
test("rename: attribute [href=\".a\"] is preserved", (t) => {
  const { output } = rename('.a[href=".a"]', { classes: { a: "b" } });
  t.is(output, '.b[href=".a"]');
});

// Example 3: targets nested inside pseudo selectors such as :is() are
// still recognized; plain-text pseudo arguments are not touched.
test("rename: .a inside :is() is renamed", (t) => {
  const { output } = rename(":is(.a, .c):lang(a)", { classes: { a: "b" } });
  t.is(output, ":is(.b, .c):lang(a)");
});

// Example 4: two sources mapping to the same target are rejected before
// anything is written, and the tree is left untouched.
test("rename: many-to-one plan is rejected atomically", (t) => {
  const root = parser().astSync(".a.c");
  const plan = { classes: { a: "x", c: "x" } };
  const error = t.throws(() => applyRenamePlan(root, plan), {
    instanceOf: RenameConflictError,
  });
  t.regex(error.message, /potential conflict/);
  t.is(root.toString(), ".a.c");
});

test("rename: ids are renamed, escaped id sources match semantically", (t) => {
  const { output, result } = rename("#main, #\\6d ain", {
    ids: { main: "primary" },
  });
  t.is(output, "#primary, #primary");
  t.deepEqual(result, { classes: 0, ids: 2 });
});

test("rename: escaped plan keys compare by actual semantics", (t) => {
  const { output } = rename(".a", { classes: { "\\61": "b" } });
  t.is(output, ".b");
});

test("rename: tag names and namespace prefixes do not participate", (t) => {
  const { output } = rename("svg|a.a", { classes: { a: "b" } });
  t.is(output, "svg|a.b");
});

test("rename: targets needing escapes are re-escaped on write", (t) => {
  const { output } = rename(".a", { classes: { a: "1 0" } });
  t.is(output, ".\\31\\ 0");
});

test("rename: raws of untouched nodes are preserved", (t) => {
  const root = parser().astSync(".fo\\o.a");
  const kept = root.nodes[0].nodes[0];
  applyRenamePlan(root, { classes: { a: "b" } });
  t.deepEqual(kept.raws, { value: "fo\\o" });
  t.is(root.toString(), ".fo\\o.b");
});

test("rename: planRenames is a dry run that mutates nothing", (t) => {
  const root = parser().astSync(":is(.a)#x");
  const planned = planRenames(root, {
    classes: { a: "b" },
    ids: { x: "y" },
  });
  t.is(planned.matches.length, 2);
  t.deepEqual(
    planned.matches.map((m) => m.kind).sort(),
    ["class", "id"],
  );
  t.is(root.toString(), ":is(.a)#x");
});

test("rename: id many-to-one conflict is rejected", (t) => {
  t.throws(
    () => rename("#a#b", { ids: { a: "x", b: "x" } }),
    { instanceOf: RenameConflictError },
  );
});

test("rename: unknown plan keys are rejected", (t) => {
  t.throws(() => rename(".a", { tags: { a: "b" } }), { instanceOf: TypeError });
});

test("rename: plan must be an object", (t) => {
  const root = parser().astSync(".a");
  t.throws(() => applyRenamePlan(root, null), { instanceOf: TypeError });
  t.throws(() => applyRenamePlan(root, "a"), { instanceOf: TypeError });
});

test("rename: kind mappings must be plain objects", (t) => {
  const root = parser().astSync(".a");
  t.throws(() => applyRenamePlan(root, { classes: ["a"] }), {
    instanceOf: TypeError,
  });
});

test("rename: targets must be non-empty strings", (t) => {
  const root = parser().astSync(".a");
  t.throws(() => applyRenamePlan(root, { classes: { a: "" } }), {
    instanceOf: TypeError,
  });
  t.throws(() => applyRenamePlan(root, { classes: { a: 1 } }), {
    instanceOf: TypeError,
  });
});

test("rename: sources must be non-empty strings", (t) => {
  const root = parser().astSync(".a");
  t.throws(() => applyRenamePlan(root, { classes: { "": "b" } }), {
    instanceOf: TypeError,
  });
});

test("rename: root must be a parsed selector node", (t) => {
  t.throws(() => planRenames({}, { classes: { a: "b" } }), {
    instanceOf: TypeError,
  });
});

test("rename: identity mappings are no-ops", (t) => {
  const { output, result } = rename(".a#a", {
    classes: { a: "a" },
    ids: { a: "a" },
  });
  t.is(output, ".a#a");
  t.deepEqual(result, { classes: 0, ids: 0 });
});

test("rename: empty kind mappings skip nodes of that kind", (t) => {
  const { output, result } = rename(".a#x", { ids: { x: "y" } });
  t.is(output, ".a#y");
  t.deepEqual(result, { classes: 0, ids: 1 });
});

test("rename: id targets needing escapes are re-escaped on write", (t) => {
  const { output } = rename("#a", { ids: { a: "1 0" } });
  t.is(output, "#\\31\\ 0");
});

test("rename: planRenames returns normalized semantic mappings", (t) => {
  const root = parser().astSync(".a");
  const planned = planRenames(root, { classes: { "\\61": "b" } });
  t.deepEqual(planned.classes, { a: "b" });
  t.deepEqual(planned.ids, {});
});
