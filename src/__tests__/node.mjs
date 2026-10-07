import test from "./util/runner.mjs";
import parser from "../../dist/index.js";
import { parse } from "./util/helpers.mjs";

test("node#clone", (t) => {
  parse('[href="test"]', (selectors) => {
    let selector = selectors.first.first;
    let clone = selector.clone();
    delete selector.parent;
    t.deepEqual(clone, selectors.first.first);
  });
});

test("node#clone of attribute", (t) => {
  parse("[href=test]", (selectors) => {
    let selector = selectors.first.first;
    let clone = selector.clone();
    delete selector.parent;
    t.deepEqual(clone, selectors.first.first);
  });
});

test("node#replaceWith", (t) => {
  let out = parse('[href="test"]', (selectors) => {
    let attr = selectors.first.first;
    let id = parser.id({ value: "test" });
    let className = parser.className({ value: "test" });
    attr.replaceWith(id, className);
  });
  t.deepEqual(out, "#test.test");
});

test("Node#appendToPropertyAndEscape", (t) => {
  let out = parse(".fo\\o", (selectors) => {
    let className = selectors.first.first;
    t.deepEqual(className.raws, { value: "fo\\o" });
    className.appendToPropertyAndEscape("value", "bar", "ba\\r");
    t.deepEqual(className.raws, { value: "fo\\oba\\r" });
  });
  t.deepEqual(out, ".fo\\oba\\r");
});

test("Node#setPropertyAndEscape with existing raws", (t) => {
  let out = parse(".fo\\o", (selectors) => {
    let className = selectors.first.first;
    t.deepEqual(className.raws, { value: "fo\\o" });
    className.setPropertyAndEscape("value", "bar", "ba\\r");
    t.deepEqual(className.raws, { value: "ba\\r" });
  });
  t.deepEqual(out, ".ba\\r");
});

test("Node#setPropertyAndEscape without existing raws", (t) => {
  let out = parse(".foo", (selectors) => {
    let className = selectors.first.first;
    t.deepEqual(className.raws, undefined);
    className.setPropertyAndEscape("value", "bar", "ba\\r");
    t.deepEqual(className.raws, { value: "ba\\r" });
  });
  t.deepEqual(out, ".ba\\r");
});

test("Node#setPropertyWithoutEscape with existing raws", (t) => {
  let out = parse(".fo\\o", (selectors) => {
    let className = selectors.first.first;
    t.deepEqual(className.raws, { value: "fo\\o" });
    className.setPropertyWithoutEscape("value", "w+t+f");
    t.deepEqual(className.raws, {});
  });
  t.deepEqual(out, ".w+t+f");
});

test("Node#setPropertyWithoutEscape without existing raws", (t) => {
  let out = parse(".foo", (selectors) => {
    let className = selectors.first.first;
    t.deepEqual(className.raws, undefined);
    className.setPropertyWithoutEscape("value", "w+t+f");
    t.deepEqual(className.raws, {});
    t.deepEqual(className.value, "w+t+f");
  });
  t.deepEqual(out, ".w+t+f");
});

test("Node#isAtPosition", (t) => {
  parse(":not(.foo),\n#foo > :matches(ol, ul)", (root) => {
    t.deepEqual(root.isAtPosition(1, 1), true);
    t.deepEqual(root.isAtPosition(1, 10), true);
    t.deepEqual(root.isAtPosition(2, 23), true);
    t.deepEqual(root.isAtPosition(2, 24), false);
    let selector = root.first;
    t.deepEqual(selector.isAtPosition(1, 1), true);
    t.deepEqual(selector.isAtPosition(1, 10), true);
    t.deepEqual(selector.isAtPosition(1, 11), false);
    let pseudoNot = selector.first;
    t.deepEqual(pseudoNot.isAtPosition(1, 1), true);
    t.deepEqual(pseudoNot.isAtPosition(1, 7), true);
    t.deepEqual(pseudoNot.isAtPosition(1, 10), true);
    t.deepEqual(pseudoNot.isAtPosition(1, 11), false);
    let notSelector = pseudoNot.first;
    t.deepEqual(notSelector.isAtPosition(1, 1), false);
    t.deepEqual(notSelector.isAtPosition(1, 4), false);
    t.deepEqual(notSelector.isAtPosition(1, 6), true);
    t.deepEqual(notSelector.isAtPosition(1, 7), true);
    t.deepEqual(notSelector.isAtPosition(1, 9), true);
    t.deepEqual(notSelector.isAtPosition(1, 10), true);
    t.deepEqual(notSelector.isAtPosition(1, 11), false);
    let notClass = notSelector.first;
    t.deepEqual(notClass.isAtPosition(1, 5), false);
    t.deepEqual(notClass.isAtPosition(1, 6), true);
    t.deepEqual(notClass.isAtPosition(1, 9), true);
    t.deepEqual(notClass.isAtPosition(1, 10), false);
    let secondSel = root.at(1);
    t.deepEqual(secondSel.isAtPosition(1, 11), false);
    t.deepEqual(secondSel.isAtPosition(2, 1), true);
    t.deepEqual(secondSel.isAtPosition(2, 23), true);
    t.deepEqual(secondSel.isAtPosition(2, 24), false);
    let combinator = secondSel.at(1);
    t.deepEqual(combinator.isAtPosition(2, 5), false);
    t.deepEqual(combinator.isAtPosition(2, 6), true);
    t.deepEqual(combinator.isAtPosition(2, 7), false);
  });
});

test("node#moveWithComments (across selectors)", (t) => {
  let out = parse("h1/*one*/.a/*two*/,h2", (selectors) => {
    let first = selectors.at(0);
    let second = selectors.at(1);
    let commentBefore = first.at(1);
    let classNode = first.at(2);
    let commentAfter = first.at(3);
    t.is(classNode.type, "class");
    t.is(commentBefore.type, "comment");
    t.is(commentAfter.type, "comment");

    let result = classNode.moveWithComments(second);

    t.is(result, classNode, "returns the moved node for chaining");
    t.is(first.length, 1, "source selector keeps only the tag");
    t.is(first.at(0).type, "tag");
    t.is(second.length, 4, "target selector gains the comment group");
    t.is(second.at(0).value, "h2");
    t.is(second.at(1), commentBefore, "leading comment keeps its position");
    t.is(second.at(2), classNode, "node keeps its position");
    t.is(second.at(3), commentAfter, "trailing comment keeps its position");
    t.is(commentBefore.parent, second, "leading comment parent updated");
    t.is(classNode.parent, second, "node parent updated");
    t.is(commentAfter.parent, second, "trailing comment parent updated");
  });
  t.deepEqual(out, "h1,h2/*one*/.a/*two*/");
});

test("node#moveWithComments (preserves raw whitespace and order)", (t) => {
  let out = parse(".a/*c0*/.b /*x*/ /*y*/ ,.c", (selectors) => {
    let first = selectors.at(0);
    let second = selectors.at(1);
    let classNode = first.at(2);
    t.is(classNode.value, "b");
    t.is(classNode.raws.spaces.after, " /*x*/ /*y*/ ");
    classNode.moveWithComments(second);
    t.is(classNode.parent, second);
    t.is(classNode.raws.spaces.after, " /*x*/ /*y*/ ", "raw whitespace and comments are kept");
    t.is(second.at(1).value, "/*c0*/", "leading comment moved before node");
  });
  t.deepEqual(out, ".a,.c/*c0*/.b /*x*/ /*y*/ ");
});

test("node#moveWithComments (invalid target leaves both trees untouched)", (t) => {
  let out = parse("h1/*one*/.a/*two*/,h2", (selectors) => {
    let first = selectors.at(0);
    let second = selectors.at(1);
    let classNode = first.at(2);
    let snapshot = first.toString() + "|" + second.toString();

    classNode.moveWithComments(null);
    classNode.moveWithComments(undefined);
    classNode.moveWithComments({});
    classNode.moveWithComments(classNode);
    classNode.moveWithComments("h2");

    t.is(classNode.parent, first, "node still belongs to the source");
    t.is(first.length, 4, "source tree unchanged");
    t.is(second.length, 1, "target tree unchanged");
    t.deepEqual(first.toString() + "|" + second.toString(), snapshot, "string output unchanged");
  });
  t.deepEqual(out, "h1/*one*/.a/*two*/,h2");
});

test("node#moveWithComments (descendant target leaves both trees untouched)", (t) => {
  let out = parse(":not(.a),.b", (selectors) => {
    let first = selectors.at(0);
    let second = selectors.at(1);
    let pseudo = first.at(0);
    let innerClass = pseudo.at(0).at(0);
    let snapshot = first.toString() + "|" + second.toString();

    first.moveWithComments(pseudo);
    pseudo.moveWithComments(pseudo.first);

    t.is(first.parent, selectors, "selector still belongs to the root");
    t.is(pseudo.parent, first, "pseudo still belongs to the selector");
    t.is(innerClass.parent, pseudo.first, "inner tree unchanged");
    t.deepEqual(first.toString() + "|" + second.toString(), snapshot);
  });
  t.deepEqual(out, ":not(.a),.b");
});
