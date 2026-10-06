import cssesc from "cssesc";
import { isClassName, isIdentifier } from "./selectors/guards";
import { ensureObject, unesc } from "./util";

/**
 * Error thrown when a rename plan is rejected before any node is mutated.
 * Currently this happens when two or more distinct source names of the same
 * kind (class or id) would be renamed to the same target name (a many-to-one
 * mapping), which would merge previously distinct selectors.
 *
 * Implemented as a plain function (not `class ... extends Error`) so the
 * ES5-compiled output keeps instanceof working without helper fallbacks.
 */
export function RenameConflictError(conflicts) {
  const details = conflicts
    .map(
      (c) =>
        `${c.kind} names ${c.sources
          .map((s) => JSON.stringify(s))
          .join(" and ")} both map to ${JSON.stringify(c.target)}`,
    )
    .join("; ");
  this.message = `Rename plan rejected: potential conflict - ${details}`;
  this.name = "RenameConflictError";
  this.conflicts = conflicts;
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, RenameConflictError);
  }
}
RenameConflictError.prototype = Object.create(Error.prototype);
RenameConflictError.prototype.constructor = RenameConflictError;

const KIND_LABELS = { classes: "class", ids: "id" };

function normalizeKind(entries, kindLabel) {
  if (entries === undefined || entries === null) {
    return new Map();
  }
  if (typeof entries !== "object" || Array.isArray(entries)) {
    throw new TypeError(
      `Rename plan "${kindLabel}" must be a plain object mapping source names to target names.`,
    );
  }
  const map = new Map();
  Object.keys(entries).forEach((rawSource) => {
    const target = entries[rawSource];
    if (typeof target !== "string" || target.length === 0) {
      throw new TypeError(
        `Rename plan "${kindLabel}" target for ${JSON.stringify(rawSource)} must be a non-empty string.`,
      );
    }
    // Compare by actual semantics: an escaped source name such as "\61"
    // refers to the same identifier as "a".
    const source = unesc(rawSource);
    if (source.length === 0) {
      throw new TypeError(
        `Rename plan "${kindLabel}" source names must be non-empty strings.`,
      );
    }
    map.set(source, target);
  });
  return map;
}

function normalizePlan(plan) {
  if (typeof plan !== "object" || plan === null || Array.isArray(plan)) {
    throw new TypeError(
      "Rename plan must be an object with optional \"classes\" and \"ids\" mappings.",
    );
  }
  Object.keys(plan).forEach((key) => {
    if (key !== "classes" && key !== "ids") {
      throw new TypeError(
        `Rename plan only supports "classes" and "ids" mappings; got unexpected key ${JSON.stringify(key)}. Tag names, namespace prefixes, attribute values and pseudo arguments do not participate in renaming.`,
      );
    }
  });
  const classes = normalizeKind(plan.classes, "classes");
  const ids = normalizeKind(plan.ids, "ids");

  // Reject many-to-one mappings before anything is written: two distinct
  // source names collapsing onto one target would merge selectors.
  const conflicts = [];
  const collectConflicts = (map, kindLabel) => {
    const byTarget = new Map();
    map.forEach((target, source) => {
      if (source === target) {
        return; // identity mapping can never merge distinct names
      }
      if (!byTarget.has(target)) {
        byTarget.set(target, []);
      }
      byTarget.get(target).push(source);
    });
    byTarget.forEach((sources, target) => {
      if (sources.length > 1) {
        conflicts.push({ kind: kindLabel, target, sources });
      }
    });
  };
  collectConflicts(classes, KIND_LABELS.classes);
  collectConflicts(ids, KIND_LABELS.ids);
  if (conflicts.length > 0) {
    throw new RenameConflictError(conflicts);
  }
  return { classes, ids };
}

function setSemanticValue(node, next) {
  // The ClassName setter maintains raws.value itself; doing it here as well
  // keeps ID nodes (which have no escaping setter) consistent and is
  // idempotent for class names.
  node.value = next;
  const escaped = cssesc(next, { isIdentifier: true });
  if (escaped !== next) {
    ensureObject(node, "raws");
    node.raws.value = escaped;
  } else if (node.raws) {
    delete node.raws.value;
  }
}

/**
 * Validates the rename plan and collects every class/id selector node that
 * would be renamed, without mutating anything. Only class and id selector
 * nodes are considered: attribute strings, pseudo-class plain-text
 * arguments, tag names and namespace prefixes never participate. Nested
 * selectors (e.g. inside :is()) are walked as well. Matching compares the
 * semantic (unescaped) node value, so `.a` and `.\61` match the same source.
 *
 * @param {object} root any container node (Root, Selector, Pseudo, ...)
 * @param {object} plan `{ classes?: {[source]: target}, ids?: {...} }`
 * @returns {{classes: {[source: string]: string}, ids: {[source: string]: string}, matches: Array<{node: object, kind: string, next: string}>}}
 */
export function planRenames(root, plan) {
  if (!root || typeof root.walk !== "function") {
    throw new TypeError(
      "planRenames expects a parsed selector node with a walk() method.",
    );
  }
  const { classes, ids } = normalizePlan(plan);
  const matches = [];
  root.walk((node) => {
    let kind = null;
    let map = null;
    if (isClassName(node)) {
      kind = "class";
      map = classes;
    } else if (isIdentifier(node)) {
      kind = "id";
      map = ids;
    } else {
      return; // tags, namespaces, attributes, strings, ... are untouched
    }
    if (map.size === 0) {
      return;
    }
    // node.value is the semantic (unescaped) identifier.
    const target = map.get(node.value);
    if (target !== undefined && target !== node.value) {
      matches.push({ node, kind, next: target });
    }
  });
  const toObject = (map) => {
    const obj = {};
    map.forEach((target, source) => {
      obj[source] = target;
    });
    return obj;
  };
  return { classes: toObject(classes), ids: toObject(ids), matches };
}

/**
 * Applies an explicit class/id rename plan to a parsed selector tree.
 * The whole plan is validated and all matches are collected first; only if
 * everything passes is anything written, so a rejected plan leaves the tree
 * untouched. Returns the number of renamed nodes per kind.
 *
 * @param {object} root any container node (Root, Selector, Pseudo, ...)
 * @param {object} plan `{ classes?: {[source]: target}, ids?: {...} }`
 * @returns {{classes: number, ids: number}}
 */
export function applyRenamePlan(root, plan) {
  const { matches } = planRenames(root, plan);
  const renamed = { classes: 0, ids: 0 };
  matches.forEach(({ node, kind, next }) => {
    setSemanticValue(node, next);
    renamed[kind === "class" ? "classes" : "ids"]++;
  });
  return renamed;
}
