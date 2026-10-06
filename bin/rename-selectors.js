#!/usr/bin/env node
"use strict";

// Explicit class/id rename command built on the parser's own AST.
// Only class and id selector nodes are renamed; attribute strings, tag
// names, namespace prefixes and pseudo-class plain-text arguments are
// left alone. Many-to-one mappings are rejected before anything is
// written out.

const parser = require("../dist/index.js");
const {
  applyRenamePlan,
  createRenamePlan,
  RenameConflictError,
} = require("../dist/rename.js");

function usage(stream) {
  stream.write(
    [
      "Usage: postcss-rename-selectors [--class from=to ...] [--id from=to ...] <selector>",
      "",
      "Examples:",
      '  postcss-rename-selectors --class a=b ".a[href=\\".a\\"]"',
      '  postcss-rename-selectors --class a=b --id x=y ":is(.a) #x"',
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const classes = {};
  const ids = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--class" || arg === "--id") {
      const pair = argv[++i];
      const eq = pair === undefined ? -1 : pair.indexOf("=");
      if (eq <= 0 || eq === pair.length - 1) {
        throw new Error(`Expected --${arg.slice(2)} from=to, got: ${pair}`);
      }
      const from = pair.slice(0, eq);
      const to = pair.slice(eq + 1);
      (arg === "--class" ? classes : ids)[from] = to;
    } else if (arg === "--help" || arg === "-h") {
      usage(process.stdout);
      process.exit(0);
    } else {
      positional.push(arg);
    }
  }
  return { classes, ids, selector: positional.join(" ") };
}

function main() {
  const { classes, ids, selector } = parseArgs(process.argv.slice(2));
  if (!selector) {
    usage(process.stderr);
    process.exitCode = 2;
    return;
  }
  let plan;
  try {
    // Validate the whole mapping first: a many-to-one plan is a
    // potential conflict and nothing is written out.
    plan = createRenamePlan({ classes, ids });
  } catch (error) {
    if (error instanceof RenameConflictError) {
      for (const conflict of error.conflicts) {
        process.stderr.write(
          `conflict: ${conflict.kind} names ${conflict.sources
            .map((name) => JSON.stringify(name))
            .join(", ")} all map to ${JSON.stringify(conflict.target)}\n`,
        );
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  const root = parser().astSync(selector);
  const renames = applyRenamePlan(root, plan);
  for (const rename of renames) {
    process.stderr.write(
      `renamed ${rename.type} ${JSON.stringify(rename.from)} -> ${JSON.stringify(rename.to)}\n`,
    );
  }
  process.stdout.write(root.toString() + "\n");
}

main();
