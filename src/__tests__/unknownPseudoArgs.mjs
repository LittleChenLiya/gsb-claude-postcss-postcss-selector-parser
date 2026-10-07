import test from "./util/runner.mjs";
import parser from "../../dist/index.js";

const RAW = { preserveUnknownPseudoArgs: true };

const astRaw = (input) => parser().astSync(input, RAW);
const processRaw = (input) => parser().processSync(input, RAW);

// --- mode switch: default parsing is unchanged ---

test("unknownPseudoArgs: default mode still parses unknown pseudo args into a selector AST", (t) => {
  const tree = parser().astSync('a:unknown(.b, "c,d")');
  const pseudo = tree.nodes[0].nodes[1];
  t.is(pseudo.type, "pseudo");
  t.is(pseudo.value, ":unknown");
  // two selector groups, because the default mode treats the comma as a group separator
  t.is(pseudo.nodes.length, 2);
  t.is(pseudo.nodes[0].type, "selector");
  t.is(pseudo.nodes[0].nodes[0].type, "class");
  t.is(pseudo.nodes[1].nodes[0].type, "string");
});

test("unknownPseudoArgs: default mode round-trips", (t) => {
  const input = 'a:unknown(.b, "c,d")';
  t.is(parser().processSync(input), input);
});

// --- raw mode: unknown pseudos keep their argument verbatim ---

test("unknownPseudoArgs: unknown pseudo argument is kept as raw text", (t) => {
  const input = "a:unknown(.b, c)";
  const pseudo = astRaw(input).nodes[0].nodes[1];
  t.is(pseudo.value, ":unknown");
  t.is(pseudo.nodes.length, 1);
  t.is(pseudo.nodes[0].type, "string");
  t.is(pseudo.nodes[0].value, ".b, c");
  t.is(processRaw(input), input);
});

test("unknownPseudoArgs: commas inside strings are not treated as selector groups", (t) => {
  const input = `a:unknown("x,y", 'z,w')`;
  const pseudo = astRaw(input).nodes[0].nodes[1];
  t.is(pseudo.nodes.length, 1);
  t.is(pseudo.nodes[0].type, "string");
  t.is(pseudo.nodes[0].value, `"x,y", 'z,w'`);
  t.is(processRaw(input), input);
});

test("unknownPseudoArgs: comments inside the argument are preserved", (t) => {
  const input = "a:unknown(/* before */ .b /* after */)";
  const pseudo = astRaw(input).nodes[0].nodes[1];
  t.is(pseudo.nodes.length, 1);
  t.is(pseudo.nodes[0].value, "/* before */ .b /* after */");
  t.is(processRaw(input), input);
});

test("unknownPseudoArgs: escapes inside the argument are preserved", (t) => {
  const input = "a:unknown(.\\31\\ 0, \\#hash)";
  const pseudo = astRaw(input).nodes[0].nodes[1];
  t.is(pseudo.nodes[0].value, ".\\31\\ 0, \\#hash");
  t.is(processRaw(input), input);
});

test("unknownPseudoArgs: nested parentheses are kept verbatim", (t) => {
  const input = "a:unknown(fn(1, 2), b)";
  const pseudo = astRaw(input).nodes[0].nodes[1];
  t.is(pseudo.nodes[0].value, "fn(1, 2), b");
  t.is(processRaw(input), input);
});

test("unknownPseudoArgs: empty argument keeps the parentheses", (t) => {
  const input = "a:unknown()";
  const pseudo = astRaw(input).nodes[0].nodes[1];
  t.is(pseudo.nodes.length, 1);
  t.is(pseudo.nodes[0].type, "string");
  t.is(pseudo.nodes[0].value, "");
  t.is(processRaw(input), input);
});

test("unknownPseudoArgs: unbalanced parenthesis still raises an error", (t) => {
  t.throws(() => processRaw("a:unknown(.b"), { message: /Expected a closing parenthesis/ });
});

// --- raw mode: known selector pseudos still get an editable child AST ---

const knownPseudos = [":is", ":not", ":has", ":where", ":matches", ":-webkit-any", ":-moz-any"];
for (const name of knownPseudos) {
  test(`unknownPseudoArgs: known selector pseudo ${name} keeps a parsed AST`, (t) => {
    const input = `a${name}(.b, .c)`;
    const pseudo = astRaw(input).nodes[0].nodes[1];
    t.is(pseudo.nodes.length, 2);
    t.is(pseudo.nodes[0].type, "selector");
    t.is(pseudo.nodes[0].nodes[0].type, "class");
    t.is(processRaw(input), input);
  });
}

test("unknownPseudoArgs: :nth-child with of-selector keeps a parsed AST", (t) => {
  const input = "a:nth-child(2n of .b, .c)";
  const pseudo = astRaw(input).nodes[0].nodes[1];
  t.true(pseudo.nodes.length > 0);
  t.is(pseudo.nodes[0].type, "selector");
  t.is(processRaw(input), input);
});

// --- acceptance: :is mixed with a custom pseudo, string commas and comments ---

test("unknownPseudoArgs: editing :is inner nodes keeps the unknown raw argument intact", (t) => {
  const input = `:is(.a, "x,y"):custom(/* keep */ .b, "c,d")`;
  const tree = astRaw(input);
  const isPseudo = tree.nodes[0].nodes[0];
  const customPseudo = tree.nodes[0].nodes[1];

  // :is is parsed into an editable AST
  t.is(isPseudo.value, ":is");
  t.is(isPseudo.nodes.length, 2);
  t.is(isPseudo.nodes[0].nodes[0].type, "class");

  // the custom pseudo only holds raw text
  t.is(customPseudo.value, ":custom");
  t.is(customPseudo.nodes.length, 1);
  t.is(customPseudo.nodes[0].type, "string");
  t.is(customPseudo.nodes[0].value, `/* keep */ .b, "c,d"`);

  // edit a node inside :is
  isPseudo.nodes[0].nodes[0].value = "renamed";

  const result = tree.toString();
  t.is(result, `:is(.renamed, "x,y"):custom(/* keep */ .b, "c,d")`);
});

test("unknownPseudoArgs: option is honoured by every public entry point", (t) => {
  const input = "a:unknown(.b, .c)";
  t.is(parser().processSync(input, RAW), input);
  const pseudo = parser().astSync(input, RAW).nodes[0].nodes[1];
  t.is(pseudo.nodes[0].type, "string");
  t.is(pseudo.nodes[0].value, ".b, .c");
  const transformed = parser((root) => root.nodes[0].nodes[1].nodes[0].type).transformSync(
    input,
    RAW,
  );
  t.is(transformed, "string");
});

test("unknownPseudoArgs: async process() honours the option", async (t) => {
  const input = "a:unknown(.b, .c)";
  const result = await parser().process(input, RAW);
  t.is(result, input);
});
