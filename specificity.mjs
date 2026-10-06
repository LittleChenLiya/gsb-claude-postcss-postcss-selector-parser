/**
 * Explicit CSS selector specificity analyzer (no browser required).
 *
 * For every input selector this tool reports, per complex selector in the
 * selector list (never merged into a single score):
 *
 *   - the (a, b, c) specificity triple, or `null` when the selector contains
 *     constructs this analyzer does not support (unknown pseudo-classes,
 *     unresolved `&` nesting selectors, ...). Unsupported constructs are
 *     listed explicitly instead of being silently folded into a fake total.
 *   - the contribution of every AST node, so each number is traceable back
 *     to the source node that produced it.
 *
 * Rules (CSS Selectors Level 4):
 *   - #id                          -> (1, 0, 0)
 *   - .class, [attr], :pseudo-class -> (0, 1, 0)
 *   - tag, ::pseudo-element        -> (0, 0, 1)
 *   - *, combinators               -> (0, 0, 0)
 *   - :where(...)                  -> always (0, 0, 0), arguments ignored
 *   - :is(...) / :not(...) / :has(...) / :matches() / :any()
 *                                  -> specificity of the MOST SPECIFIC argument
 *   - :nth-child(An+B [of S]?) / :nth-last-child(...)
 *                                  -> (0, 1, 0) plus most specific selector of S
 *   - & (nesting)                  -> only resolved when a parent selector is
 *                                     explicitly passed (options.parent /
 *                                     --parent); takes the specificity of the
 *                                     most specific complex selector of that
 *                                     parent. Otherwise unsupported.
 *
 * Usage:
 *   node specificity.mjs [--parent "<parent selector>"] [--json] "<selector>" [...]
 *
 * Example (four selectors):
 *   node specificity.mjs ":where(#x).a" ":is(.a,#b)" "nav > .item:hover::after" "#a, .b[href] span"
 */

import parser from "./dist/index.js";

const ZERO = [0, 0, 0];

/** Pseudo-classes that take a selector list and adopt its most specific argument. */
const MAX_OF_ARGUMENTS_PSEUDOS = new Set(["is", "not", "has", "matches", "any"]);

/** An+B pseudos with an optional `of S` clause. */
const NTH_PSEUDOS = new Set(["nth-child", "nth-last-child"]);

/** Functional pseudo-classes whose arguments carry no selector specificity. */
const FUNCTIONAL_NO_SELECTOR_ARGS = new Set(["lang", "dir", "current"]);

/** Legacy single-colon pseudo-elements (count as type selectors). */
const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

/**
 * Known non-functional pseudo-classes (count as one class-level selector).
 * Anything not listed here is reported as *unsupported* rather than being
 * silently added to the class column.
 */
const KNOWN_PSEUDO_CLASSES = new Set([
  "link", "visited", "hover", "active", "focus", "focus-visible", "focus-within",
  "target", "target-within", "scope",
  "enabled", "disabled", "checked", "indeterminate", "required", "optional",
  "valid", "invalid", "in-range", "out-of-range", "read-only", "read-write",
  "placeholder-shown", "autofill", "default", "user-valid", "user-invalid",
  "first-child", "last-child", "only-child", "first-of-type", "last-of-type",
  "only-of-type", "empty", "root", "defined", "host",
  "fullscreen", "modal", "popover-open", "open", "closed", "blank",
  "picture-in-picture", "playing", "paused", "seeking", "buffering",
  "stuck", "snapped", "muted", "volume-locked", "local-link",
  "past", "future", "left", "right", "first", "only",
  "active-view-transition",
]);

function pseudoName(node) {
  return String(node.value).replace(/^:+/, "").toLowerCase();
}

function isPseudoElement(node) {
  return String(node.value).startsWith("::");
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Signed comparison of two triples (a vs b). */
function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function nodeLabel(node) {
  return String(node);
}

function ok(contribution) {
  return { specificity: contribution.specificity, contributions: [contribution], unsupported: [] };
}

function unsupportedResult(base, reason) {
  return {
    specificity: null,
    contributions: [{ ...base, specificity: null, note: `UNSUPPORTED: ${reason}` }],
    unsupported: [{ node: base.node, type: base.type, reason }],
  };
}

/**
 * Analyze one complex selector (a `selector` AST node).
 * `specificity` is null when any unsupported construct was found inside.
 */
function analyzeComplexSelector(selectorNode, options) {
  const contributions = [];
  const unsupported = [];
  let total = [...ZERO];

  for (const node of selectorNode.nodes) {
    const part = analyzeNode(node, options);
    contributions.push(...part.contributions);
    unsupported.push(...part.unsupported);
    if (part.specificity) total = add(total, part.specificity);
  }

  return {
    specificity: unsupported.length ? null : total,
    contributions,
    unsupported,
  };
}

/** Analyze a single AST node. */
function analyzeNode(node, options) {
  const base = { node: nodeLabel(node), type: node.type };

  switch (node.type) {
    case "id":
      return ok({ ...base, specificity: [1, 0, 0], note: "ID selector" });

    case "class":
      return ok({ ...base, specificity: [0, 1, 0], note: "class selector" });

    case "attribute":
      return ok({ ...base, specificity: [0, 1, 0], note: "attribute selector" });

    case "tag":
      return ok({ ...base, specificity: [0, 0, 1], note: "type selector" });

    case "universal":
      return ok({ ...base, specificity: [0, 0, 0], note: "universal selector contributes nothing" });

    case "combinator":
      return ok({ ...base, specificity: [0, 0, 0], note: "combinator contributes nothing" });

    case "comment":
      return { specificity: [...ZERO], contributions: [], unsupported: [] };

    case "nesting": {
      if (!options.parent) {
        return unsupportedResult(
          base,
          "nesting selector '&' is only resolved when a parent selector is explicitly passed (options.parent / --parent)",
        );
      }
      const parentReport = analyzeSelectorList(options.parent, options);
      if (parentReport.unsupported.length) {
        return unsupportedResult(
          base,
          "parent selector itself contains unsupported constructs: " +
            parentReport.unsupported.map((u) => u.node).join(", "),
        );
      }
      let best = null;
      let bestSelector = null;
      for (const entry of parentReport.selectors) {
        if (best === null || compare(entry.specificity, best) > 0) {
          best = entry.specificity;
          bestSelector = entry.selector;
        }
      }
      return ok({
        ...base,
        specificity: best,
        note: `nesting selector '&' takes the specificity of the most specific complex selector of the explicit parent (${bestSelector})`,
        source: bestSelector,
      });
    }

    case "pseudo":
      return analyzePseudo(node, options, base);

    default:
      return unsupportedResult(base, `unsupported AST node type '${node.type}'`);
  }
}

function analyzePseudo(node, options, base) {
  const name = pseudoName(node);

  if (isPseudoElement(node)) {
    return ok({ ...base, specificity: [0, 0, 1], note: "pseudo-element" });
  }

  if (name === "where") {
    return ok({
      ...base,
      specificity: [0, 0, 0],
      note: ":where() always contributes zero specificity; its arguments are ignored",
    });
  }

  if (MAX_OF_ARGUMENTS_PSEUDOS.has(name)) {
    return analyzeMaxOfArguments(node, name, options, base);
  }

  if (NTH_PSEUDOS.has(name)) {
    return analyzeNth(node, name, options, base);
  }

  if (FUNCTIONAL_NO_SELECTOR_ARGS.has(name)) {
    return ok({
      ...base,
      specificity: [0, 1, 0],
      note: `:${name}() is a pseudo-class; its arguments carry no selector specificity`,
    });
  }

  if (node.nodes && node.nodes.length > 0) {
    return unsupportedResult(
      base,
      `unknown functional pseudo-class ':${name}(...)'; arguments are not interpreted and no specificity is assumed`,
    );
  }

  if (LEGACY_PSEUDO_ELEMENTS.has(name)) {
    return ok({ ...base, specificity: [0, 0, 1], note: "legacy single-colon pseudo-element" });
  }

  if (KNOWN_PSEUDO_CLASSES.has(name)) {
    return ok({ ...base, specificity: [0, 1, 0], note: "known pseudo-class" });
  }

  return unsupportedResult(
    base,
    `unknown pseudo-class ':${name}'; not counted to avoid a fabricated total`,
  );
}

/**
 * :is() / :not() / :has() / :matches() / :any():
 * adopt the specificity of the most specific argument. Every argument is
 * analyzed and reported so the chosen source stays traceable.
 */
function analyzeMaxOfArguments(node, name, options, base) {
  const args = (node.nodes || []).map((sel) => {
    const r = analyzeComplexSelector(sel, options);
    return { argument: String(sel), ...r };
  });

  const unsupported = args.flatMap((a) => a.unsupported);
  if (unsupported.length || args.length === 0) {
    const reason =
      args.length === 0
        ? `:${name}() has no arguments`
        : `:${name}() contains unsupported constructs; the most specific argument cannot be determined`;
    return {
      specificity: null,
      contributions: [
        { ...base, specificity: null, note: `UNSUPPORTED: ${reason}`, arguments: args },
      ],
      unsupported: unsupported.length
        ? unsupported
        : [{ node: base.node, type: base.type, reason }],
    };
  }

  let best = args[0];
  for (const arg of args.slice(1)) {
    if (compare(arg.specificity, best.specificity) > 0) best = arg;
  }

  return {
    specificity: best.specificity,
    contributions: [
      {
        ...base,
        specificity: best.specificity,
        note: `:${name}() adopts the specificity of its most specific argument (${best.argument})`,
        source: best.argument,
        arguments: args,
      },
    ],
    unsupported: [],
  };
}

/**
 * :nth-child(An+B [of S]?) / :nth-last-child(...):
 * (0,1,0) plus, when an `of S` clause is present, the most specific selector of S.
 */
function analyzeNth(node, name, options, base) {
  // The parser comma-splits the pseudo argument, but the `of S` clause is
  // itself a selector *list*: reassemble everything after the `of` keyword,
  // across comma boundaries, before analyzing it.
  const ofParts = [];
  let collecting = false;
  for (const sel of node.nodes || []) {
    const nodes = sel.nodes || [];
    if (!collecting) {
      const ofIndex = nodes.findIndex(
        (n) => n.type === "tag" && String(n.value).toLowerCase() === "of",
      );
      if (ofIndex !== -1) {
        collecting = true;
        ofParts.push(nodes.slice(ofIndex + 1).map(String).join(""));
      }
    } else {
      ofParts.push(nodes.map(String).join(""));
    }
  }
  const ofText = ofParts.join(",").trim();
  const ofTexts = ofText ? [ofText] : [];

  const args = ofTexts.map((text) => {
    const report = analyzeSelectorList(text, options);
    return { argument: text, selectors: report.selectors, unsupported: report.unsupported };
  });

  const unsupported = args.flatMap((a) => a.unsupported);
  if (unsupported.length) {
    return {
      specificity: null,
      contributions: [
        {
          ...base,
          specificity: null,
          note: `UNSUPPORTED: :${name}() 'of S' clause contains unsupported constructs`,
          arguments: args,
        },
      ],
      unsupported,
    };
  }

  let extra = [...ZERO];
  let source = null;
  for (const arg of args) {
    for (const entry of arg.selectors) {
      if (compare(entry.specificity, extra) > 0) {
        extra = entry.specificity;
        source = entry.selector;
      }
    }
  }

  const specificity = add([0, 1, 0], extra);
  return {
    specificity,
    contributions: [
      {
        ...base,
        specificity,
        note: source
          ? `:${name}() counts as one pseudo-class plus the most specific selector of its 'of' clause (${source})`
          : `:${name}() counts as one pseudo-class`,
        ...(source ? { source } : {}),
        ...(args.length ? { arguments: args } : {}),
      },
    ],
    unsupported: [],
  };
}

/**
 * Analyze a full selector string which may contain a comma-separated list.
 * Each complex selector is reported separately; results are never merged
 * into a single score.
 */
export function analyzeSelectorList(input, options = {}) {
  const root = parser().astSync(String(input));
  const selectors = root.nodes.map((sel) => {
    const r = analyzeComplexSelector(sel, options);
    return {
      selector: String(sel),
      specificity: r.specificity,
      contributions: r.contributions,
      unsupported: r.unsupported,
    };
  });
  return {
    input: String(input),
    selectors,
    unsupported: selectors.flatMap((s) => s.unsupported),
  };
}

function formatTriple(t) {
  return t ? `(${t.join(", ")})` : "(unsupported)";
}

export function formatReport(report) {
  const lines = [];
  lines.push(`input: ${report.input}`);
  for (const sel of report.selectors) {
    lines.push(`  selector: ${sel.selector}`);
    lines.push(`  specificity: ${formatTriple(sel.specificity)}`);
    for (const c of sel.contributions) {
      lines.push(
        `    - ${c.node} [${c.type}] ${formatTriple(c.specificity)}${c.note ? ` -- ${c.note}` : ""}`,
      );
    }
    for (const u of sel.unsupported) {
      lines.push(`    ! unsupported: ${u.node} -- ${u.reason}`);
    }
  }
  return lines.join("\n");
}

function main(argv) {
  const options = {};
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--parent") {
      options.parent = argv[++i];
    } else if (argv[i] === "--json") {
      options.json = true;
    } else {
      inputs.push(argv[i]);
    }
  }
  if (inputs.length === 0) {
    console.error(
      'usage: node specificity.mjs [--parent "<selector>"] [--json] "<selector>" [...]',
    );
    process.exitCode = 2;
    return;
  }
  const reports = inputs.map((input) => analyzeSelectorList(input, options));
  if (options.json) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  } else {
    console.log(reports.map(formatReport).join("\n\n"));
  }
}

if (process.argv[1] && process.argv[1].endsWith("specificity.mjs")) {
  main(process.argv.slice(2));
}
