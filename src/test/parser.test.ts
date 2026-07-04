import * as assert from "assert";
import { Tokenizer } from "../tokenizer";
import { parseTokens } from "../parser";

function parse(src: string) {
	return parseTokens(new Tokenizer(src).tokenize());
}

suite("Parser", () => {
	suite("includes", () => {
		test("single include", () => {
			const ast = parse('include "other.zing"');
			assert.strictEqual(ast.includes.length, 1);
			assert.strictEqual(ast.includes[0].path, "other.zing");
		});

		test("multiple includes", () => {
			const ast = parse('include "a.zing"\ninclude "b.zing"');
			assert.strictEqual(ast.includes.length, 2);
			assert.strictEqual(ast.includes[0].path, "a.zing");
			assert.strictEqual(ast.includes[1].path, "b.zing");
		});
	});

	suite("parameters", () => {
		test("parameter with default", () => {
			const ast = parse("parameter tempo 60 to 200 = 120");
			assert.strictEqual(ast.parameters.length, 1);
			assert.strictEqual(ast.parameters[0].name, "tempo");
			assert.strictEqual(ast.parameters[0].min, "60");
			assert.strictEqual(ast.parameters[0].max, "200");
			assert.strictEqual(ast.parameters[0].defaultValue, "120");
		});

		test("parameter without default", () => {
			const ast = parse("parameter volume 0 to 100");
			assert.strictEqual(ast.parameters.length, 1);
			assert.strictEqual(ast.parameters[0].name, "volume");
			assert.strictEqual(ast.parameters[0].defaultValue, undefined);
		});

		test("parameter with negative range", () => {
			const ast = parse("parameter pan -100 to 100 = 0");
			assert.strictEqual(ast.parameters[0].min, "-100");
			assert.strictEqual(ast.parameters[0].max, "100");
		});
	});

	suite("members", () => {
		test("module declaration", () => {
			const ast = parse("module MyMod");
			assert.strictEqual(ast.members.length, 1);
			assert.strictEqual(ast.members[0].kind, "Module");
			assert.strictEqual(ast.members[0].name, "MyMod");
			assert.strictEqual(ast.members[0].context, "Global");
		});

		test("function declaration", () => {
			const ast = parse("function myFunc");
			assert.strictEqual(ast.members.length, 1);
			assert.strictEqual(ast.members[0].kind, "Function");
			assert.strictEqual(ast.members[0].name, "myFunc");
		});

		test("instrument declaration", () => {
			const ast = parse("instrument piano");
			assert.strictEqual(ast.members.length, 1);
			assert.strictEqual(ast.members[0].kind, "Instrument");
			assert.strictEqual(ast.members[0].name, "piano");
		});

		test("global context", () => {
			const ast = parse("global module main");
			assert.strictEqual(ast.members[0].context, "Global");
		});

		test("note context", () => {
			const ast = parse("note module process");
			assert.strictEqual(ast.members[0].context, "Note");
		});

		test("member name is single Id (no :: qualified names)", () => {
			const ast = parse("module Foo::Bar::Baz");
			assert.strictEqual(ast.members.length, 1);
			assert.strictEqual(ast.members[0].name, "Baz");
			assert.strictEqual(ast.members[0].midiParams.length, 2);
		});

		test("member with inputs and outputs", () => {
			const ast = parse("module proc (in: stereo number) -> (out: stereo number)");
			assert.strictEqual(ast.members[0].inputs.length, 1);
			assert.strictEqual(ast.members[0].inputs[0].name, "in");
			assert.strictEqual(ast.members[0].outputs.length, 1);
			assert.strictEqual(ast.members[0].outputs[0].name, "out");
		});

		test("member with body", () => {
			const ast = parse("module proc () -> (out: stereo number)\n  out = 1.0");
			assert.strictEqual(ast.members[0].body.length, 1);
		});

test("midi mapping param", () => {
			const ast = parse("kick:: module main () -> (out: stereo number)");
			assert.strictEqual(ast.members[0].midiParams.length, 1);
			assert.strictEqual(ast.members[0].midiParams[0].name, "kick");
		});

		test("midi mapping number param on member is not parsed (MidiParam is only Id ::)", () => {
			// Real grammar: MidiParam is only Id ::, not Num ::
			// 1:: is tokenized as Decimal + ColonColon, so the parser sees 1 as a stray number
			// followed by :: as a stray operator, then module main ...
			const ast = parse("1:: module main () -> (out: stereo number)");
			assert.strictEqual(ast.members.length, 0);
		});

		test("call with midi value mapping channel only", () => {
			const ast = parse("module m () -> (o)\n  o = 1::proc(x)");
			const expr = ast.members[0].body[0].expression as any;
			assert.strictEqual(expr.kind, "Call");
			assert.strictEqual(expr.midiArgs.length, 1);
			assert.strictEqual(expr.midiArgs[0].kind, "Value");
			assert.strictEqual(expr.midiArgs[0].channel, 1);
			assert.strictEqual(expr.midiArgs[0].range.start, 0);
			assert.strictEqual(expr.midiArgs[0].range.end, 127);
			assert.strictEqual(expr.midiArgs[0].transposeTo, 255);
		});

		test("call with midi value mapping single note", () => {
			const ast = parse("module m () -> (o)\n  o = 1{C4}::proc(x)");
			const expr = ast.members[0].body[0].expression as any;
			assert.strictEqual(expr.kind, "Call");
			assert.strictEqual(expr.midiArgs[0].kind, "Value");
			assert.strictEqual(expr.midiArgs[0].channel, 1);
			assert.strictEqual(expr.midiArgs[0].range.start, 48); // C4 = 0 + 0 + 4*12
			assert.strictEqual(expr.midiArgs[0].range.end, 48);
			assert.strictEqual(expr.midiArgs[0].transposeTo, 48);
		});

		test("call with midi value mapping range", () => {
			const ast = parse("module m () -> (o)\n  o = 1{C4..G5}::proc(x)");
			const expr = ast.members[0].body[0].expression as any;
			assert.strictEqual(expr.kind, "Call");
			assert.strictEqual(expr.midiArgs[0].kind, "Value");
			assert.strictEqual(expr.midiArgs[0].channel, 1);
			assert.strictEqual(expr.midiArgs[0].range.start, 48); // C4 = 0 + 0 + 4*12
			assert.strictEqual(expr.midiArgs[0].range.end, 67);  // G5 = 7 + 0 + 5*12
			assert.strictEqual(expr.midiArgs[0].transposeTo, 48); // default = start
		});

		test("call with midi value mapping range and transpose", () => {
			const ast = parse("module m () -> (o)\n  o = 1{C4..G5 / C3}::proc(x)");
			const expr = ast.members[0].body[0].expression as any;
			assert.strictEqual(expr.kind, "Call");
			assert.strictEqual(expr.midiArgs[0].kind, "Value");
			assert.strictEqual(expr.midiArgs[0].transposeTo, 36); // C3 = 0 + 0 + 3*12
		});

		test("call with midi named mapping", () => {
			const ast = parse("module m () -> (o)\n  o = kick::proc(x)");
			const expr = ast.members[0].body[0].expression as any;
			assert.strictEqual(expr.kind, "Call");
			assert.strictEqual(expr.midiArgs.length, 1);
			assert.strictEqual(expr.midiArgs[0].kind, "Named");
			assert.strictEqual(expr.midiArgs[0].name, "kick");
		});

		test("call with sharp note in midi range", () => {
			const ast = parse("module m () -> (o)\n  o = 1{C#4}::proc(x)");
			const expr = ast.members[0].body[0].expression as any;
			assert.strictEqual(expr.midiArgs[0].range.start, 49); // C#4 = 0 + 1 + 4*12
			assert.strictEqual(expr.midiArgs[0].range.end, 49);
		});

		test("call with open range ..G5", () => {
			const ast = parse("module m () -> (o)\n  o = 1{..G5}::proc(x)");
			const expr = ast.members[0].body[0].expression as any;
			assert.strictEqual(expr.midiArgs[0].range.start, 255); // unspecified
			assert.strictEqual(expr.midiArgs[0].range.end, 67);    // G5 = 7 + 0 + 5*12
		});

		test("call with open range C4..", () => {
			const ast = parse("module m () -> (o)\n  o = 1{C4..}::proc(x)");
			const expr = ast.members[0].body[0].expression as any;
			assert.strictEqual(expr.midiArgs[0].range.start, 48); // C4 = 0 + 0 + 4*12
			assert.strictEqual(expr.midiArgs[0].range.end, 127);  // max
		});

		test("multiple members", () => {
			const ast = parse("function foo\nmodule bar\ninstrument baz");
			assert.strictEqual(ast.members.length, 3);
			assert.strictEqual(ast.members[0].name, "foo");
			assert.strictEqual(ast.members[1].name, "bar");
			assert.strictEqual(ast.members[2].name, "baz");
		});
	});

	suite("type annotations", () => {
		test("full type annotation", () => {
			const ast = parse("module m (x: static mono number) -> (y: dynamic stereo number)");
			const inp = ast.members[0].inputs[0].type;
			assert.strictEqual(inp?.scope, "Static");
			assert.strictEqual(inp?.width, "Mono");
			assert.strictEqual(inp?.valueType, "Number");

			const out = ast.members[0].outputs[0].type;
			assert.strictEqual(out?.scope, "Dynamic");
			assert.strictEqual(out?.width, "Stereo");
			assert.strictEqual(out?.valueType, "Number");
		});

		test("partial type annotation", () => {
			const ast = parse("module m (x: mono) -> (y: stereo)");
			assert.strictEqual(ast.members[0].inputs[0].type?.width, "Mono");
			assert.strictEqual(ast.members[0].inputs[0].type?.scope, undefined);
		});

		test("no type annotation", () => {
			const ast = parse("module m (x) -> (y)");
			assert.strictEqual(ast.members[0].inputs[0].type, undefined);
		});
	});

	suite("expressions", () => {
		test("number literal", () => {
			const ast = parse("module m () -> (o)\n  o = 3.14");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "NumberLiteral");
		});

		test("boolean literal", () => {
			const ast = parse("module m () -> (o)\n  o = true");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "BoolLiteral");
		});

		test("variable", () => {
			const ast = parse("module m () -> (o)\n  o = x");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "Variable");
		});

		test("binary expression", () => {
			const ast = parse("module m () -> (o)\n  o = a + b");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "Binary");
		});

		test("unary negation", () => {
			const ast = parse("module m () -> (o)\n  o = -x");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "Unary");
		});

		test("function call", () => {
			const ast = parse("module m () -> (o)\n  o = sin(x)");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "Call");
		});

		test("tuple", () => {
			const ast = parse("module m () -> (o)\n  o = (a, b)");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "Tuple");
		});

		test("conditional", () => {
			const ast = parse("module m () -> (o)\n  o = c ? a : b");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "Conditional");
		});

		test("buffer literal", () => {
			const ast = parse("module m () -> (o)\n  o = { 1, 2, 3 }");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "BufferLiteral");
		});

		test("merge", () => {
			const ast = parse("module m () -> (o)\n  o = [a, b]");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "Merge");
		});

		test("buffer index", () => {
			const ast = parse("module m () -> (o)\n  o = buf[i]");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "BufferIndex");
		});

		test("tuple index", () => {
			const ast = parse("module m () -> (o)\n  o = t.0");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "TupleIndex");
		});

		test("unary binds looser than tuple index: -t.0 = -(t.0)", () => {
			const ast = parse("module m () -> (o)\n  o = -t.0");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "Unary");
			const unary = expr as any;
			assert.strictEqual(unary.operand.kind, "TupleIndex");
		});

		test("buffer index chains at unary level", () => {
			const ast = parse("module m () -> (o)\n  o = buf[i]");
			const expr = ast.members[0].body[0].expression;
			assert.strictEqual(expr.kind, "BufferIndex");
		});
	});

	suite("program structure", () => {
		test("includes before parameters before members", () => {
			const src = 'include "a.zing"\nparameter p 0 to 1\nmodule m';
			const ast = parse(src);
			assert.strictEqual(ast.includes.length, 1);
			assert.strictEqual(ast.parameters.length, 1);
			assert.strictEqual(ast.members.length, 1);
		});

		test("empty program", () => {
			const ast = parse("");
			assert.strictEqual(ast.includes.length, 0);
			assert.strictEqual(ast.parameters.length, 0);
			assert.strictEqual(ast.members.length, 0);
		});
	});

	suite("parse errors", () => {
		test("valid program has no parse errors", () => {
			const ast = parse("module main () -> (out)");
			assert.strictEqual(ast.parseErrors.length, 0);
		});

		test("member with no name produces error", () => {
			const ast = parse("module () -> (out)");
			assert.ok(ast.parseErrors.length > 0);
			assert.ok(ast.parseErrors[0].message.includes("missing name"));
		});

		test("member with number instead of name produces error", () => {
			const ast = parse("instrument 1{C4..G5}::bells (n) -> (o)");
			assert.ok(ast.parseErrors.length > 0);
			assert.ok(ast.parseErrors[0].message.includes("missing name"));
		});

		test("missing arrow in member produces error", () => {
			const ast = parse("module foo () (out)");
			assert.ok(ast.parseErrors.length > 0);
			assert.ok(ast.parseErrors[0].message.includes("expected"));
		});

		test("missing closing paren in pattern produces error", () => {
			const ast = parse("module foo (x -> (out)");
			assert.ok(ast.parseErrors.length > 0);
		});

		test("statement with no expression produces error", () => {
			const ast = parse("module m () -> (o)\n  x =");
			assert.ok(ast.parseErrors.length > 0);
		});

		test("statement with no equals sign produces error", () => {
			const ast = parse("module m () -> (o)\n  x");
			assert.ok(ast.parseErrors.length > 0);
		});

		test("hex number followed by identifier is not a single token", () => {
			const ast = parse("module m () -> (o)\n  x = 0x1.8p0");
			assert.ok(ast.parseErrors.length > 0);
		});

		test("missing string in include produces error", () => {
			const ast = parse("include");
			assert.ok(ast.parseErrors.length > 0);
		});

		test("missing closing paren in call args produces error", () => {
			const ast = parse("module m () -> (o)\n  x = foo(a, b");
			assert.ok(ast.parseErrors.length > 0);
		});

		test("missing closing brace in buffer literal produces error", () => {
			const ast = parse("module m () -> (o)\n  x = { 0.0, 1.0");
			assert.ok(ast.parseErrors.length > 0);
		});

		test("missing closing bracket in merge produces error", () => {
			const ast = parse("module m () -> (o)\n  x = [a, b");
			assert.ok(ast.parseErrors.length > 0);
		});

		test("missing closing bracket in buffer index produces error", () => {
			const ast = parse("module m () -> (o)\n  x = buf[i");
			assert.ok(ast.parseErrors.length > 0);
		});

		test("for loop missing to keyword produces error", () => {
			const ast = parse("module m () -> (o)\n  x = for i 10 add val");
			assert.ok(ast.parseErrors.length > 0);
		});

		test("valid buffer init produces no errors", () => {
			const ast = parse("module m () -> (o)\n  x = for 10 stereo buffer val");
			assert.strictEqual(ast.parseErrors.length, 0);
		});

		test("errors include position information", () => {
			const ast = parse("instrument 1{C4..G5}::bells (n) -> (o)");
			assert.ok(ast.parseErrors[0].position.line >= 0);
			assert.ok(ast.parseErrors[0].position.character >= 0);
		});

		test("parser continues after error (lenient)", () => {
			const ast = parse("module foo () -> (o)\ninstrument 1{C4..G5}::bar (n) -> (o)\nmodule baz () -> (o)");
			assert.strictEqual(ast.members.length, 3);
			assert.strictEqual(ast.members[0].name, "foo");
			assert.ok(ast.members[1].name.length === 0);
			assert.strictEqual(ast.members[2].name, "baz");
			assert.ok(ast.parseErrors.length > 0);
		});
	});
});