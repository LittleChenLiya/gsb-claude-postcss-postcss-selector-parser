import { isContainer, isComment } from "../selectors/guards";

/**
 * Move a node — together with the comment siblings directly before and
 * after it — from its current parent into `target`.
 *
 * The moved nodes keep their identity, so raw whitespace (`raws`,
 * `spaces`) and the relative order of the comments are preserved. Every
 * moved node is detached from the source container before it is appended
 * to the target, so no stale `parent` pointers are left behind when
 * moving across selectors.
 *
 * If `node` has no container parent, or `target` is not a container (or
 * is the node itself / lives inside the node), neither tree is modified
 * and `false` is returned.
 *
 * @param {object} node the node to move
 * @param {object} target the container that receives the node and its comments
 * @returns {object[]|false} the moved nodes in their original order, or
 *   `false` when the move was rejected
 */
export default function moveNodeWithComments(node, target) {
  if (
    !node ||
    typeof node !== "object" ||
    !target ||
    typeof target !== "object" ||
    !isContainer(target)
  ) {
    return false;
  }
  // Reject targets that are the node itself or one of its descendants;
  // moving there would create a cycle in the tree.
  for (let ancestor = target; ancestor; ancestor = ancestor.parent) {
    if (ancestor === node) {
      return false;
    }
  }
  let source = node.parent;
  if (!isContainer(source) || !Array.isArray(source.nodes)) {
    return false;
  }
  let index = source.nodes.indexOf(node);
  if (index < 0) {
    return false;
  }

  // Collect the comment siblings adjacent to the node, keeping their
  // relative order: leading comments, the node, trailing comments.
  let start = index;
  while (start > 0 && isComment(source.nodes[start - 1])) {
    start--;
  }
  let end = index;
  while (end + 1 < source.nodes.length && isComment(source.nodes[end + 1])) {
    end++;
  }
  let moving = source.nodes.slice(start, end + 1);

  // Detach everything from the source before touching the target so a
  // cross-selector move never leaves stale parent pointers behind.
  for (let child of moving) {
    source.removeChild(child);
  }
  for (let child of moving) {
    target.append(child);
  }
  return moving;
}
