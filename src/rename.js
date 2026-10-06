import cssesc from "cssesc";
import { ensureObject } from "./util";

/**
 * Explicit class/id rename planning on top of the parsed selector AST.
 *
 * The parser itself is untouched: a plan is validated up front (including
 * many-to-one conflict detection) and only then applied to the matching
 * `class` and `id` selector nodes. Attribute strings, tag names, namespace
 * prefixes and pseudo-class arguments that are plain text are never treated
 * as class or id names; nested selectors (e.g. inside `:is()`) are walked
 * normally. Escaped names are compared by their semantic (unescaped) value
 * because the parser already stores the unescaped form on `node.value`.
 */

export class RenameConflictError extends Error {
  constructor(conflicts) {
    super(
      "Rename plan has potential conflicts: " +
        conflicts
          .map(
            (conflict) =>
              `${conflict.kind} names ${conflict.sources
                .map((source) => JSON.stringify(source))
                .join(" and ")} both map to ${JSON.stringify(conflict.target)}`,
          )
          .join("; "),
    );
    // The build targets ES5, where extending a built-in loses the subclass
    // prototype; restore it so `instanceof RenameConflictError` works.
    Object.setPrototypeOf(this, RenameConflictError.prototype);
    this.name = "RenameConflictError";
    this.conflicts = conflicts;
  }
}

function normalizeEntries(mapping, kind) {
  if (mapping === undefined || mapping === null) {
    return [];
  }
  let entries;
  if (mapping instanceof Map) {
    entries = Array.from(mapping.entries());
  } else if (Array.isArray(mapping)) {
    entries = mapping.slice();
  } else if (typeof mapping === "object") {
    entries = Object.keys(mapping).map((key) => [key, mapping[key]]);
  } else {
    throw new TypeError(
      `The ${kind} rename mapping must be an object, a Map or an array of [from, to] pairs.`,
    );
  }
  return entries.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TypeError(`Each ${kind} rename entry must be a [from, to] pair.`);
    }
    let [from, to] = entry;
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      from.length === 0 ||
      to.length === 0
    ) {
      throw new TypeError(`The ${kind} rename mapping must use non-empty string names.`);
    }
    return [from, to];
  });
}

function normalizeKind(mapping, kind, conflicts) {
  let entries = normalizeEntries(mapping, kind);
  let byTarget = new Map();
  let plan = new Map();
  for (let [from, to] of entries) {
    if (plan.has(from)) {
      throw new TypeError(`Duplicate ${kind} rename source ${JSON.stringify(from)}.`);
    }
    plan.set(from, to);
    if (byTarget.has(to)) {
      let existing = byTarget.get(to);
      if (!existing.includes(from)) {
        existing.push(from);
      }
    } else {
      byTarget.set(to, [from]);
    }
  }
  for (let [target, sources] of byTarget) {
    if (sources.length > 1) {
      conflicts.push({ kind, sources, target });
    }
  }
  return plan;
}

/**
 * Validate rename mappings and build a plan without touching any AST.
 *
 * A many-to-one mapping (two different sources renamed to the same target)
 * is a potential conflict: every conflict is reported and a
 * `RenameConflictError` is thrown before anything is written out.
 *
 * @param {object} [options]
 * @param {object|Map|Array} [options.classes] class name mapping (from => to)
 * @param {object|Map|Array} [options.ids] id name mapping (from => to)
 * @returns {{classes: Map<string, string>, ids: Map<string, string>}}
 */
export function createRenamePlan(options = {}) {
  let conflicts = [];
  let classes = normalizeKind(options.classes, "class", conflicts);
  let ids = normalizeKind(options.ids, "id", conflicts);
  if (conflicts.length > 0) {
    throw new RenameConflictError(conflicts);
  }
  return { classes, ids };
}

function setSelectorValue(node, value) {
  node.value = value;
  // `ClassName` syncs `raws.value` from its value setter; `ID` (and any
  // other node without an escaping setter) keeps a stale escaped raw
  // otherwise, so refresh the raw escaped form explicitly. Unrelated raws
  // (spaces, comments, untouched nodes) are left alone.
  let escaped = cssesc(value, { isIdentifier: true });
  if (escaped !== value) {
    ensureObject(node, "raws");
    node.raws.value = escaped;
  } else if (node.raws) {
    delete node.raws.value;
  }
}

function collectRenames(root, plan, renames) {
  if (plan.classes.size > 0) {
    root.walkClasses((node) => {
      if (plan.classes.has(node.value)) {
        renames.push({
          type: "class",
          from: node.value,
          to: plan.classes.get(node.value),
          node,
        });
      }
    });
  }
  if (plan.ids.size > 0) {
    root.walkIds((node) => {
      if (plan.ids.has(node.value)) {
        renames.push({
          type: "id",
          from: node.value,
          to: plan.ids.get(node.value),
          node,
        });
      }
    });
  }
}

/**
 * Apply a validated plan to a parsed selector AST. All matching nodes are
 * collected first and only then written, so a failure cannot leave a
 * half-renamed tree behind.
 *
 * @param {object} root a selector AST root (e.g. from `parser().astSync()`)
 * @param {object} plan a plan from `createRenamePlan`
 * @returns {Array<{type: string, from: string, to: string}>} applied renames
 */
export function applyRenamePlan(root, plan) {
  let renames = [];
  collectRenames(root, plan, renames);
  for (let rename of renames) {
    setSelectorValue(rename.node, rename.to);
  }
  return renames.map(({ type, from, to }) => ({ type, from, to }));
}

/**
 * Validate the mappings and rename matching class/id nodes in one call.
 * Throws `RenameConflictError` before mutating anything when the mapping
 * has potential conflicts.
 *
 * @param {object} root a selector AST root
 * @param {object} [options] mappings, see `createRenamePlan`
 * @returns {Array<{type: string, from: string, to: string}>} applied renames
 */
export function renameSelectors(root, options = {}) {
  return applyRenamePlan(root, createRenamePlan(options));
}
