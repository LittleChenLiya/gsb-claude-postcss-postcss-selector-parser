import ava from "./util/runner.mjs";
import parser from "../../dist/index.js";
import moveNodeWithCommentsModule from "../../dist/util/moveNodeWithComments.js";

const moveNodeWithComments = moveNodeWithCommentsModule.default;

ava("moveNodeWithComments() moves a class with two comments across selectors", (t) => {
  let root = parser().astSync("h1, /*one*/.b/*two*/h4, h3");
  let source = root.nodes[1];
  let target = root.nodes[2];
  let classNode = source.nodes[1];
  t.is(classNode.type, "class");

  let moved = moveNodeWithComments(classNode, target);

  t.deepEqual(
    moved.map((node) => node.type),
    ["comment", "class", "comment"],
    "leading comments, the node and trailing comments move in their original order",
  );
  t.is(
    root.toString(),
    "h1,h4, h3 /*one*/.b/*two*/",
    "comments move with the node and raw whitespace is preserved",
  );
  t.true(
    moved.every((node) => node.parent === target),
    "moved nodes point at the target container",
  );
  t.deepEqual(
    source.nodes.map((node) => node.type),
    ["tag"],
    "no stale entries remain in the source selector",
  );
  t.true(
    source.nodes.every((node) => node.parent === source),
    "remaining source nodes keep their parent",
  );
});

ava("moveNodeWithComments() preserves raw whitespace around the moved node", (t) => {
  let root = parser().astSync("h1, /*one*/ .b /*two*/, h3");
  let source = root.nodes[1];
  let target = root.nodes[2];
  let classNode = source.nodes.find((node) => node.type === "class");
  let rawBefore = classNode.rawSpaceBefore;
  let rawAfter = classNode.rawSpaceAfter;

  let moved = moveNodeWithComments(classNode, target);

  t.is(root.toString(), "h1,, h3 /*one*/ .b /*two*/");
  t.is(moved.length, 2, "the sibling comment and the class node move");
  t.is(classNode.rawSpaceBefore, rawBefore, "raw space before is untouched");
  t.is(classNode.rawSpaceAfter, rawAfter, "raw comment in the trailing raw space is untouched");
});

ava("moveNodeWithComments() rejects an invalid target without touching either tree", (t) => {
  let input = "h1, /*one*/.b/*two*/h4, h3";
  let root = parser().astSync(input);
  let source = root.nodes[1];
  let classNode = source.nodes[1];
  let snapshot = source.nodes.slice();

  t.false(moveNodeWithComments(classNode, null), "null target is rejected");
  t.false(moveNodeWithComments(classNode, classNode), "the node itself is rejected");
  t.false(moveNodeWithComments(classNode, source.nodes[3]), "a non-container node is rejected");

  t.is(root.toString(), input, "the source string is unchanged");
  t.deepEqual(source.nodes, snapshot, "the source selector still holds the same nodes");
  t.is(classNode.parent, source, "the node still belongs to its original parent");
  t.is(source.nodes[0].parent, source, "the leading comment still belongs to the source");
  t.is(source.nodes[2].parent, source, "the trailing comment still belongs to the source");
});

ava("moveNodeWithComments() rejects a node without a container parent", (t) => {
  let root = parser().astSync("h1, h2");
  let detached = parser.className({ value: "b" });
  t.false(moveNodeWithComments(detached, root.nodes[1]));
  t.false(moveNodeWithComments(null, root.nodes[1]));
  t.is(root.toString(), "h1, h2", "nothing was modified");
});
