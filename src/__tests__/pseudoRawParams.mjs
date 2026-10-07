import test from "./util/runner.mjs";
import parser from "../../dist/index.js";

const RAW = { preserveUnknownPseudoParams: true };

const parseRaw = (input) => parser().astSync(input, RAW);
const processRaw = (input) => parser().processSync(input, RAW);

test("default mode still parses unknown pseudo params into a selector AST", (t) => {
  let tree = parser().astSync(":custom(.a, .b)");
  let pseudo = tree.nodes[0].nodes[0];
  t.is(pseudo.type, "pseudo");
  t.is(pseudo.nodes.length, 2);
  t.is(pseudo.nodes[0].nodes[0].value, "a");
  t.falsy(pseudo.raws && pseudo.raws.params);
  // and round-trips as before
  t.is(parser().processSync(":custom(.a, .b)"), ":custom(.a, .b)");
});

test("raw mode keeps unknown pseudo params as raw text without child nodes", (t) => {
  let pseudo = parseRaw(":custom(.a, .b)").nodes[0].nodes[0];
  t.is(pseudo.nodes.length, 0);
  t.is(pseudo.raws.params, ".a, .b");
  t.is(processRaw(":custom(.a, .b)"), ":custom(.a, .b)");
});

test("raw mode preserves comments, escapes and string commas verbatim", (t) => {
  let input = ":custom(.a\\:b, \"x,y\", /* keep */ .z)";
  t.is(processRaw(input), input);
  let pseudo = parseRaw(input).nodes[0].nodes[0];
  t.is(pseudo.raws.params, '.a\\:b, "x,y", /* keep */ .z');
});

test("raw mode does not treat commas inside strings as selector groups", (t) => {
  let input = ':custom("a,b", "c,d")';
  let pseudo = parseRaw(input).nodes[0].nodes[0];
  t.is(pseudo.nodes.length, 0);
  t.is(pseudo.raws.params, '"a,b", "c,d"');
  t.is(processRaw(input), input);
});

test("raw mode balances nested parens and parens inside strings", (t) => {
  let input = ':custom(fn(1, 2), "str)")';
  t.is(processRaw(input), input);
  t.is(parseRaw(input).nodes[0].nodes[0].raws.params, 'fn(1, 2), "str)"');
});

test("raw mode keeps known selector pseudos as editable AST", (t) => {
  for (let name of [":is", ":where", ":not", ":has", ":nth-child", ":matches", ":-webkit-any"]) {
    let args = name === ":nth-child" ? "2n of .a, .b" : ".a, .b";
    let pseudo = parseRaw(`${name}(${args})`).nodes[0].nodes[0];
    t.true(pseudo.nodes.length > 0, `${name} should have child nodes`);
    t.falsy(pseudo.raws && pseudo.raws.params, `${name} should not have raw params`);
  }
});

test("mixed known :is and unknown pseudo: editing :is keeps unknown raw intact", (t) => {
  let input = ':is(.a, "x,y" /*c*/) :custom(1, "x,y", /* keep */ .z)';
  let tree = parseRaw(input);
  let pseudos = tree.nodes[0].nodes.filter((n) => n.type === "pseudo");
  let isPseudo = pseudos[0];
  let customPseudo = pseudos[1];
  t.is(isPseudo.value, ":is");
  t.true(isPseudo.nodes.length > 0);
  t.is(customPseudo.raws.params, '1, "x,y", /* keep */ .z');

  // modify a node inside :is
  isPseudo.nodes[0].nodes[0].value = "b";
  t.is(tree.toString(), ':is(.b, "x,y" /*c*/) :custom(1, "x,y", /* keep */ .z)');

  // old (default) mode is still compatible with the same input
  t.is(parser().processSync(input), input);
});

test("raw pseudo survives clone with its raw params", (t) => {
  let tree = parseRaw(':custom("a,b" /*c*/)');
  let clone = tree.clone();
  t.is(clone.toString(), ':custom("a,b" /*c*/)');
});

test("processSync accepts the option through the processor interface", (t) => {
  let input = ":is(.a) :custom(.x, .y)";
  t.is(parser().processSync(input, RAW), input);
  t.is(parser().processSync(input), input);
});

test("raw mode still reports unbalanced parentheses", (t) => {
  t.throws(() => processRaw(":custom(.a, .b"), { message: /closing parenthesis/ });
});
