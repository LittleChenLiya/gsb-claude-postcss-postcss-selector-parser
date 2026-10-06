#!/usr/bin/env node
/**
 * Node command for explicit specificity analysis.
 *
 * Usage:
 *   node bin/specificity.js [--parent-selector <selector>] <selector>...
 *   node bin/specificity.js --examples
 *
 * Prints one JSON report per input. Every selector in a selector list gets
 * its own report with an [a, b, c] triple and per-AST-node contributions;
 * list members are never merged into a single score. Unsupported constructs
 * (unknown pseudo-classes/elements, `&` without --parent-selector) yield
 * `specificity: null` instead of a fabricated total.
 */
"use strict";


let analyzeSpecificity;
try {
  analyzeSpecificity = require("../dist/specificity.js").analyzeSpecificity;
} catch {
  console.error("dist/ is not built yet. Run `npm run build` first.");
  process.exit(2);
}

// Four canonical examples, also exercised by the test suite.
const EXAMPLES = [
  { selector: ":where(#x).a", note: ":where() contributes zero; only the class counts" },
  { selector: ":is(.a,#b)", note: ":is() takes the most specific (ID) branch" },
  {
    selector: "ul#nav li.active a:hover::before",
    note: "IDs, classes, types and pseudo-elements accumulate per node",
  },
  {
    selector: "#a, .b > :unknown-pseudo, & .child",
    parentSelector: ".site-header",
    note: "selector list reported individually; unknown pseudo gives no total; " +
      "'&' resolved via the explicitly passed parent selector",
  },
];

function printReport(input, options) {
  const report = analyzeSpecificity(input, options);
  console.log(JSON.stringify(report, null, 2));
}

function runExamples() {
  EXAMPLES.forEach((example, index) => {
    console.log(`# Example ${index + 1}: ${example.selector}`);
    console.log(`# ${example.note}`);
    printReport(example.selector, { parentSelector: example.parentSelector });
    console.log("");
  });
}

function usage() {
  console.log(
    [
      "Usage:",
      "  node bin/specificity.js [--parent-selector <selector>] <selector>...",
      "  node bin/specificity.js --examples",
      "",
      "Options:",
      "  -p, --parent-selector <selector>  explicit parent selector used to resolve '&'",
      "      --examples                    run the four built-in examples",
      "  -h, --help                        show this help",
    ].join("\n"),
  );
}

function main(argv) {
  const options = {};
  const selectors = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--examples") {
      runExamples();
      return 0;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      return 0;
    } else if (arg === "-p" || arg === "--parent-selector") {
      index++;
      if (index >= argv.length) {
        console.error(`${arg} requires a selector argument`);
        return 2;
      }
      options.parentSelector = argv[index];
    } else if (arg.startsWith("--parent-selector=")) {
      options.parentSelector = arg.slice("--parent-selector=".length);
    } else {
      selectors.push(arg);
    }
  }
  if (selectors.length === 0) {
    usage();
    return 2;
  }
  selectors.forEach((selector, index) => {
    if (index > 0) {
      console.log("");
    }
    printReport(selector, options);
  });
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { EXAMPLES, main };
