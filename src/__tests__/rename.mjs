import test from "./util/runner.mjs";
import parser from "../../dist/index.js";
import {
  applyRenamePlan,
  createRenamePlan,
  RenameConflictError,
  renameSelectors,
} from "../../dist/rename.js";

const ast = (input) => parser().astSync(input);

test("rename: exposed on the main entry", (t) => {
  t.is(typeof parser.createRenamePlan, "function");
  t.is(typeof parser.applyRenamePlan, "function");
  t.is(typeof parser.renameSelectors, "function");
  t.is(typeof parser.RenameConflictError, "function");
});

test("rename: plain class node is renamed", (t) => {
  let tree = ast(".a");
  let applied = renameSelectors(tree, { classes: { a: "b" } });
  t.is(tree.toString(), ".b");
  t.deepEqual(applied, [{ type: "class", from: "a", to: "b" }]);
});

test("rename: escaped class name matches by semantic value", (t) => {
  // ".\\61" is the escaped form of ".a"; both spellings rename together.
  let tree = ast(".a, .\\61");
  renameSelectors(tree, { classes: { a: "b" } });
  t.is(tree.toString(), ".b, .b");
});

test("rename: attribute string is not treated as a class", (t) => {
  let tree = ast('.a[href=".a"]');
  renameSelectors(tree, { classes: { a: "b" } });
  t.is(tree.toString(), '.b[href=".a"]');
});

test("rename: pseudo-class plain text argument is not treated as a class", (t) => {
  let tree = ast(":lang(a).a");
  renameSelectors(tree, { classes: { a: "b" } });
  t.is(tree.toString(), ":lang(a).b");
});

test("rename: class inside nested :is() selector is renamed", (t) => {
  let tree = ast(":is(.a, .c).a");
  renameSelectors(tree, { classes: { a: "b" } });
  t.is(tree.toString(), ":is(.b, .c).b");
});

test("rename: id node is renamed", (t) => {
  let tree = ast("#x.a");
  renameSelectors(tree, { ids: { x: "y" }, classes: { a: "b" } });
  t.is(tree.toString(), "#y.b");
});

test("rename: class mapping does not touch ids and vice versa", (t) => {
  let tree = ast("#a.a");
  renameSelectors(tree, { classes: { a: "b" } });
  t.is(tree.toString(), "#a.b");
  let tree2 = ast("#a.a");
  renameSelectors(tree2, { ids: { a: "b" } });
  t.is(tree2.toString(), "#b.a");
});

test("rename: escaped id raw form is refreshed", (t) => {
  // "#\\31" is the escaped form of "#1".
  let tree = ast("#\\31");
  renameSelectors(tree, { ids: { 1: "one" } });
  t.is(tree.toString(), "#one");
});

test("rename: tag name and namespace prefix are not renamed", (t) => {
  let tree = ast("svg|a.a");
  renameSelectors(tree, { classes: { a: "b" } });
  t.is(tree.toString(), "svg|a.b");
});

test("rename: rename target needing escapes is re-escaped", (t) => {
  let tree = ast(".a");
  renameSelectors(tree, { classes: { a: "1a" } });
  t.is(tree.toString(), ".\\31 a");
});

test("rename: untouched raws are preserved", (t) => {
  // The escaped raw of the untouched node and the spacing raws survive;
  // only the targeted node's value (and its own raws.value) change.
  let tree = ast(".\\61  .c");
  renameSelectors(tree, { classes: { c: "d" } });
  t.is(tree.toString(), ".\\61  .d");
});

test("rename: many-to-one class mapping is rejected before writing", (t) => {
  let tree = ast(".a.b");
  let error = t.throws(
    () => renameSelectors(tree, { classes: { a: "c", b: "c" } }),
    { instanceOf: RenameConflictError },
  );
  t.deepEqual(error.conflicts, [
    { kind: "class", sources: ["a", "b"], target: "c" },
  ]);
  // nothing was written out
  t.is(tree.toString(), ".a.b");
});

test("rename: many-to-one id mapping is rejected", (t) => {
  t.throws(() => createRenamePlan({ ids: { x: "z", y: "z" } }), {
    instanceOf: RenameConflictError,
  });
});

test("rename: all conflicts are reported at once", (t) => {
  let error = t.throws(
    () =>
      createRenamePlan({
        classes: { a: "c", b: "c" },
        ids: { x: "z", y: "z" },
      }),
    { instanceOf: RenameConflictError },
  );
  t.is(error.conflicts.length, 2);
});

test("rename: one-to-one mapping chain is allowed", (t) => {
  let tree = ast(".a.b");
  renameSelectors(tree, { classes: { a: "b", b: "c" } });
  t.is(tree.toString(), ".b.c");
});

test("rename: createRenamePlan validates names", (t) => {
  t.throws(() => createRenamePlan({ classes: { a: "" } }), {
    instanceOf: TypeError,
  });
  t.throws(() => createRenamePlan({ classes: "nope" }), {
    instanceOf: TypeError,
  });
});

test("rename: applyRenamePlan applies a pre-built plan", (t) => {
  let plan = createRenamePlan({ classes: { a: "b" } });
  let tree = ast(".a");
  let applied = applyRenamePlan(tree, plan);
  t.is(tree.toString(), ".b");
  t.deepEqual(applied, [{ type: "class", from: "a", to: "b" }]);
});

test("rename: processor integration rewrites the selector string", (t) => {
  let result = parser((root) => {
    renameSelectors(root, { classes: { a: "b" }, ids: { x: "y" } });
  }).processSync('.a[href=".a"] #x');
  t.is(result, '.b[href=".a"] #y');
});
