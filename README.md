# postcss-selector-parser

[![npm package version](https://img.shields.io/github/package-json/v/postcss/postcss-selector-parser) ![npm downloads](https://img.shields.io/npm/dm/postcss-selector-parser)](https://www.npmjs.com/package/postcss-selector-parser)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/postcss/postcss-selector-parser/test.yml)](https://github.com/postcss/postcss-selector-parser/actions)
[![License](https://img.shields.io/github/license/postcss/postcss-selector-parser)](https://github.com/postcss/postcss-selector-parser)  

> Selector parser with built in methods for working with selector strings.

## Install

With [npm](https://npmjs.com/package/postcss-selector-parser) do:

```
npm install postcss-selector-parser
```

## Quick Start

```js
const parser = require('postcss-selector-parser');
const transform = selectors => {
    selectors.walk(selector => {
        // do something with the selector
        console.log(String(selector))
    });
};

const transformed = parser(transform).processSync('h1, h2, h3');
```

To normalize selector whitespace:

```js
const parser = require('postcss-selector-parser');
const normalized = parser().processSync('h1, h2, h3', {lossless: false});
// -> h1,h2,h3
```

Async support is provided through `parser.process` and will resolve a Promise
with the resulting selector string.

## Specificity analysis

This repository also ships an explicit specificity analyzer
(`src/specificity.js`, built to `dist/specificity.js`) and a small Node
command for it. Instead of a single opaque number, every selector in a
selector list gets its own report — list members are never merged into one
score — containing the `[a, b, c]` triple, one entry per AST node with that
node's own contribution (traceable via `sourceIndex` and a human readable
`reason`), and an `unsupported` list:

```
npm run specificity -- ":where(#x).a"     # or: node bin/specificity.js ":where(#x).a"
node bin/specificity.js --examples        # run the four built-in examples
node bin/specificity.js --parent-selector "#p" "& .a"
```

Rules implemented:

- `:where(#x).a` → `[0, 1, 0]`: `:where()` and its arguments contribute zero,
  only the class counts (the zeroed `#x` contribution is still reported).
- `:is(.a,#b)` → `[1, 0, 0]`: `:is()`/`:not()`/`:has()` are replaced by their
  most specific argument; every argument's own triple is listed under
  `arguments` so the chosen branch stays traceable.
- Unknown pseudo-classes/elements (e.g. `:unknown-pseudo`) are reported as
  `unsupported` and the selector's `specificity` becomes `null` — unknown
  constructs never produce a fabricated total.
- The nesting selector `&` is only resolved when a parent selector is
  explicitly passed (`--parent-selector` / `options.parentSelector`); it then
  scores like `:is(<parentSelector>)`. Without it, `&` is `unsupported`.

Programmatic use:

```js
const { analyzeSpecificity } = require("./dist/specificity.js");

const report = analyzeSpecificity(":where(#x).a", { parentSelector: "#p" });
// report.selectors[0].specificity   -> [0, 1, 0]
// report.selectors[0].contributions -> per-AST-node [a, b, c] contributions
// report.selectors[0].unsupported   -> constructs that could not be scored
```

## API

Please see [API.md](API.md).

## Security

### Selector nesting depth (CVE-2026-9358)

The parser walks the selector AST recursively, both when parsing and when
serializing it back to a string (`.toString()`). In versions up to and
including `7.1.1`, a selector with extreme nesting — for example thousands of
nested `:not(...)` — could recurse deeply enough to overflow the call stack and
throw `RangeError: Maximum call stack size exceeded`, a potential
denial-of-service when processing untrusted CSS.

This is now bounded by a maximum nesting depth (default: `256`). Beyond that
depth, parsing and serialization throw a regular, catchable `Error` at a
predictable point instead of relying on the runtime hitting its stack limit.
The default is far above any realistic selector, so it does not affect normal
use.

**Practical impact is low.** The only attacker-controlled input is the selector
string itself, which is now capped by the default limit. The limit is
adjustable through the `maxNestingDepth` option, but that option is trusted
configuration provided by the integrating code — it is never derived from the
parsed CSS, so a malicious selector cannot change it:

```js
// Tighten the limit when parsing untrusted input:
parser().processSync(untrustedSelector, {maxNestingDepth: 128});
```

Raising `maxNestingDepth` to a very large value is an explicit, informed choice
and can reintroduce the stack-overflow risk in environments with a small call
stack (e.g. browser workers). The default is recommended unless you have a
specific need.

## Credits

* Huge thanks to Andrey Sitnik (@ai) for work on PostCSS which helped
  accelerate this module's development.

## License

MIT
