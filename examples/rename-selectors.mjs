// Four selector examples for the explicit class/id rename plan.
// Run with: node examples/rename-selectors.mjs
import parser from "../dist/index.js";
import {
  RenameConflictError,
  renameSelectors,
} from "../dist/rename.js";

const show = (title, fn) => {
  try {
    console.log(`${title}\n  => ${fn()}`);
  } catch (error) {
    console.log(`${title}\n  => rejected: ${error.message}`);
  }
};

// 1. ".a" and the escaped spelling ".\\61" are the same name semantically,
//    so both are renamed together.
show('1. escaped same-name class: ".a, .\\61" (a -> b)', () => {
  const root = parser().astSync(".a, .\\61");
  renameSelectors(root, { classes: { a: "b" } });
  return root.toString();
});

// 2. Attribute strings are not classes: [href=".a"] is preserved while
//    the real class node is renamed.
show('2. attribute string preserved: ".a[href=\\".a\\"]" (a -> b)', () => {
  const root = parser().astSync('.a[href=".a"]');
  renameSelectors(root, { classes: { a: "b" } });
  return root.toString();
});

// 3. Nested selectors are still walked: ".a" inside ":is()" is renamed.
show('3. nested :is() to ".c" kept: ":is(.a, .c)" (a -> b)', () => {
  const root = parser().astSync(":is(.a, .c)");
  renameSelectors(root, { classes: { a: "b" } });
  return root.toString();
});

// 4. Two sources mapping to the same target is a potential conflict:
//    the plan is rejected before anything is written out.
show('4. many-to-one conflict: ".a.b" (a -> c, b -> c)', () => {
  const root = parser().astSync(".a.b");
  try {
    renameSelectors(root, { classes: { a: "c", b: "c" } });
    return root.toString();
  } catch (error) {
    if (error instanceof RenameConflictError) {
      return `rejected, selector unchanged: ${root.toString()}`;
    }
    throw error;
  }
});
