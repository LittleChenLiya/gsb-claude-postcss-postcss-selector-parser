// Explicit CSS selector specificity analysis: per-selector [a, b, c] triples
// with per-AST-node contributions; see analyzeSpecificity below for details.
const Processor = require("./processor").default;
const { ATTRIBUTE, CLASS, COMBINATOR, COMMENT, ID } = require("./selectors/types");
const { NESTING, PSEUDO, SELECTOR, STRING, TAG, UNIVERSAL } = require("./selectors/types");

// Support tables for known pseudo-classes/elements, built once at load time.
// Pseudo-classes whose argument is a selector list (:is() etc.) are replaced
// by their most specific argument (Selectors Level 4); functional forms whose
// arguments are not selectors (e.g. :nth-child(2n + 1), :lang(en)) count as
// (0, 1, 0) on their own because their arguments add nothing.
function buildSupportTables() {
  const toSet = (list) => new Set(list.split(" "));
  const maxOfArguments = toSet("is matches any -moz-any -webkit-any not has");
  const knownClasses = toSet(
    "active any-link autofill blank buffering checked closed current default defined dir " +
      "disabled empty enabled first first-child first-of-type focus focus-visible " +
      "focus-within fullscreen future host host-context hover in-range indeterminate " +
      "invalid lang last-child last-of-type left link local-link modal muted nth-child " +
      "nth-col nth-last-child nth-last-col nth-last-of-type nth-of-type only-child " +
      "only-of-type open optional out-of-range past paused picture-in-picture " +
      "placeholder-shown playing popover-open read-only read-write required right root " +
      "scope seeking stalled state target target-within user-invalid user-valid valid " +
      "visited volume-locked",
  );
  // Legacy pseudo-elements that may be written with a single colon.
  const legacyElements = toSet("after before first-letter first-line");
  const knownElements = toSet(
    "after before first-letter first-line active-view-transition active-view-transition-type " +
      "backdrop checkmark column cue cue-region details-content file-selector-button " +
      "grammar-error highlight marker part picker picker-icon placeholder scroll-marker " +
      "scroll-marker-group scroll-next scroll-prev selection slotted spelling-error " +
      "target-text view-transition view-transition-group view-transition-image-pair " +
      "view-transition-new view-transition-old",
  );
  // Pseudo-elements whose selector argument adds to the total (::slotted()).
  const elementsWithSelectorArgument = toSet("slotted");
  return {
    maxOfArguments,
    knownClasses,
    legacyElements,
    knownElements,
    elementsWithSelectorArgument,
  };
}

const SUPPORT = buildSupportTables();
const MAX_OF_ARGUMENTS_PSEUDO_CLASSES = SUPPORT.maxOfArguments;
const KNOWN_PSEUDO_CLASSES = SUPPORT.knownClasses;
const LEGACY_PSEUDO_ELEMENTS = SUPPORT.legacyElements;
const KNOWN_PSEUDO_ELEMENTS = SUPPORT.knownElements;
const PSEUDO_ELEMENTS_WITH_SELECTOR_ARGUMENT = SUPPORT.elementsWithSelectorArgument;

function addTriple(left, right) {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

// Lexicographic comparison of two [a, b, c] triples.
function compareTriples(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function pseudoName(node) {
  return node.value.replace(/^:+/, "").toLowerCase();
}

function isDoubleColon(node) {
  return node.value.startsWith("::");
}

// Lossless stringification keeps raw whitespace after commas; trim it for
// readability, except on combinators where the whitespace is the meaning.
function nodeText(node) {
  const text = node.toString();
  return node.type === COMBINATOR ? text : text.trim();
}

function makeContribution(node, specificity, reason, extra) {
  return Object.assign(
    {
      node: node.type,
      value: nodeText(node),
      sourceIndex: node.sourceIndex,
      specificity,
      reason,
    },
    extra,
  );
}

function makeUnsupported(node, reason) {
  return {
    node: node.type,
    value: nodeText(node),
    sourceIndex: node.sourceIndex,
    reason,
  };
}

// Analyze one complex selector AST node; specificity is null when unsupported.
function analyzeSelectorNode(selectorNode, options) {
  const context = {
    options,
    contributions: [],
    unsupported: [],
  };
  const total = analyzeChildren(selectorNode, context, false);
  const supported = context.unsupported.length === 0;
  return {
    selector: selectorNode.toString().trim(),
    sourceIndex: selectorNode.sourceIndex,
    supported,
    specificity: supported ? total : null,
    contributions: context.contributions,
    unsupported: context.unsupported,
  };
}

function analyzeChildren(container, context, suppressed) {
  let total = [0, 0, 0];
  container.each((child) => {
    total = addTriple(total, analyzeNode(child, context, suppressed));
  });
  return total;
}

function recordContribution(context, suppressed, node, specificity, reason, extra) {
  if (suppressed) {
    context.contributions.push(
      makeContribution(node, [0, 0, 0], `${reason}; suppressed to zero inside :where()`, extra),
    );
    return [0, 0, 0];
  }
  context.contributions.push(makeContribution(node, specificity, reason, extra));
  return specificity;
}

function analyzeNode(node, context, suppressed) {
  switch (node.type) {
    case ID:
      return recordContribution(context, suppressed, node, [1, 0, 0], "ID selector");
    case CLASS:
      return recordContribution(context, suppressed, node, [0, 1, 0], "class selector");
    case ATTRIBUTE:
      return recordContribution(context, suppressed, node, [0, 1, 0], "attribute selector");
    case TAG:
      return recordContribution(context, suppressed, node, [0, 0, 1], "type selector");
    case UNIVERSAL:
      return recordContribution(
        context,
        suppressed,
        node,
        [0, 0, 0],
        "universal selector contributes zero",
      );
    case COMBINATOR:
      return recordContribution(
        context,
        suppressed,
        node,
        [0, 0, 0],
        "combinator contributes zero",
      );
    case COMMENT:
      // Comments carry no meaning; they are not reported as contributions.
      return [0, 0, 0];
    case STRING:
      return recordContribution(context, suppressed, node, [0, 0, 0], "string contributes zero");
    case SELECTOR:
      // A nested selector node (e.g. an argument of :where()); recurse.
      return analyzeChildren(node, context, suppressed);
    case NESTING:
      return analyzeNesting(node, context, suppressed);
    case PSEUDO:
      return analyzePseudo(node, context, suppressed);
    default:
      context.unsupported.push(makeUnsupported(node, `unsupported AST node type "${node.type}"`));
      return [0, 0, 0];
  }
}

function analyzeNesting(node, context, suppressed) {
  const parentSelector = context.options.parentSelector;
  if (typeof parentSelector !== "string" || parentSelector.trim() === "") {
    context.unsupported.push(
      makeUnsupported(
        node,
        "nesting selector '&' is only resolved when a parent selector is explicitly " +
          "passed via the parentSelector option",
      ),
    );
    return [0, 0, 0];
  }
  const parentReport = analyzeSpecificity(parentSelector);
  const broken = [];
  parentReport.selectors.forEach((parent) => {
    if (!parent.supported) {
      broken.push(parent.selector);
    }
  });
  if (broken.length > 0) {
    context.unsupported.push(
      makeUnsupported(
        node,
        `parent selector contains unsupported constructs: ${broken.join(", ")}`,
      ),
    );
    return [0, 0, 0];
  }
  let best = [0, 0, 0];
  parentReport.selectors.forEach((parent) => {
    if (compareTriples(parent.specificity, best) > 0) {
      best = parent.specificity;
    }
  });
  return recordContribution(
    context,
    suppressed,
    node,
    best,
    `nesting selector '&' resolved like :is(${parentSelector}) from the explicitly ` +
      "passed parentSelector",
    {
      arguments: parentReport.selectors.map((parent) => ({
        selector: parent.selector,
        specificity: parent.specificity,
      })),
    },
  );
}

function analyzePseudo(node, context, suppressed) {
  const name = pseudoName(node);
  if (isDoubleColon(node)) {
    return analyzePseudoElement(node, name, context, suppressed);
  }
  if (LEGACY_PSEUDO_ELEMENTS.has(name)) {
    return recordContribution(
      context,
      suppressed,
      node,
      [0, 0, 1],
      `legacy pseudo-element ${node.value}`,
    );
  }
  if (name === "where") {
    // :where() itself and everything inside it contribute zero. Children are
    // still walked so their (zeroed) contributions stay traceable.
    context.contributions.push(
      makeContribution(node, [0, 0, 0], ":where() and its arguments always contribute zero", {
        arguments: collectArgumentSummaries(node, context),
      }),
    );
    return analyzeChildren(node, context, true);
  }
  if (MAX_OF_ARGUMENTS_PSEUDO_CLASSES.has(name)) {
    return analyzeMaxOfArguments(node, name, context, suppressed);
  }
  if (KNOWN_PSEUDO_CLASSES.has(name)) {
    return recordContribution(context, suppressed, node, [0, 1, 0], `pseudo-class ${node.value}`);
  }
  context.unsupported.push(
    makeUnsupported(
      node,
      `unknown pseudo-class ${node.value}; not counted to avoid a fabricated total`,
    ),
  );
  return [0, 0, 0];
}

function analyzePseudoElement(node, name, context, suppressed) {
  if (!KNOWN_PSEUDO_ELEMENTS.has(name)) {
    context.unsupported.push(
      makeUnsupported(
        node,
        `unknown pseudo-element ${node.value}; not counted to avoid a fabricated total`,
      ),
    );
    return [0, 0, 0];
  }
  if (PSEUDO_ELEMENTS_WITH_SELECTOR_ARGUMENT.has(name) && node.length > 0) {
    const argumentBest = maxOfArgumentSelectors(node, context);
    if (argumentBest === null) {
      return [0, 0, 0];
    }
    const total = addTriple([0, 0, 1], argumentBest.specificity);
    return recordContribution(
      context,
      suppressed,
      node,
      total,
      `pseudo-element ${node.value} contributes (0,0,1) plus its most specific argument`,
      { arguments: argumentBest.arguments },
    );
  }
  return recordContribution(context, suppressed, node, [0, 0, 1], `pseudo-element ${node.value}`);
}

// Score each selector argument of a functional pseudo and pick the max.
function maxOfArgumentSelectors(pseudoNode, context) {
  const summaries = [];
  let best = null;
  let failed = false;
  pseudoNode.each((argument) => {
    const report = analyzeSelectorNode(argument, context.options);
    summaries.push({ selector: report.selector, specificity: report.specificity });
    if (!report.supported) {
      failed = true;
      report.unsupported.forEach((entry) => context.unsupported.push(entry));
      return;
    }
    if (best === null || compareTriples(report.specificity, best.specificity) > 0) {
      best = report;
    }
  });
  if (failed || best === null) {
    return null;
  }
  return { specificity: best.specificity, arguments: summaries };
}

function collectArgumentSummaries(pseudoNode, context) {
  const summaries = [];
  pseudoNode.each((argument) => {
    const report = analyzeSelectorNode(argument, context.options);
    summaries.push({ selector: report.selector, specificity: report.specificity });
  });
  return summaries;
}

function analyzeMaxOfArguments(node, name, context, suppressed) {
  const result = maxOfArgumentSelectors(node, context);
  if (result === null) {
    return [0, 0, 0];
  }
  return recordContribution(
    context,
    suppressed,
    node,
    result.specificity,
    `:${name}() is replaced by its most specific argument`,
    { arguments: result.arguments },
  );
}

// Analyze a selector (or selector list) and report each selector individually;
// list members are never merged into a single score. options.parentSelector
// explicitly resolves the nesting selector `&`; without it `&` is unsupported.
export function analyzeSpecificity(input, options = {}) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("analyzeSpecificity expects a non-empty selector string");
  }
  const processor = new Processor();
  const root = processor.astSync(input);
  const selectors = [];
  root.each((selectorNode) => {
    selectors.push(analyzeSelectorNode(selectorNode, options));
  });
  return { input, selectors };
}

export default analyzeSpecificity;
