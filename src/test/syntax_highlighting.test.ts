import * as assert from "assert";
import { semanticLegend } from "../syntax_highlighting";
import { Tokenizer } from "../tokenizer";
import { parseTokens } from "../parser";
import { filterTokens } from "../tokenizer";
import { Expression } from "../ast";

suite("Syntax Highlighting", () => {
	suite("tokenizer defaults", () => {
		test("keywords are recognized", () => {
			const tokens = new Tokenizer("module function instrument include parameter for buffer").tokenize();
			for (let i = 0; i < 7; i++) {
				assert.strictEqual(tokens[i].kind, ["Module", "Function", "Instrument", "Include", "Parameter", "For", "Buffer"][i]);
			}
		});

		test("context modifiers", () => {
			const tokens = new Tokenizer("global note").tokenize();
			assert.strictEqual(tokens[0].kind, "Global");
			assert.strictEqual(tokens[1].kind, "Note");
		});

		test("scope keywords", () => {
			const tokens = new Tokenizer("static dynamic").tokenize();
			assert.strictEqual(tokens[0].kind, "Static");
			assert.strictEqual(tokens[1].kind, "Dynamic");
		});

		test("width keywords", () => {
			const tokens = new Tokenizer("mono stereo generic").tokenize();
			assert.strictEqual(tokens[0].kind, "Mono");
			assert.strictEqual(tokens[1].kind, "Stereo");
			assert.strictEqual(tokens[2].kind, "Generic");
		});

		test("value type keywords", () => {
			const tokens = new Tokenizer("number bool").tokenize();
			assert.strictEqual(tokens[0].kind, "NumberKw");
			assert.strictEqual(tokens[1].kind, "BoolKw");
		});

		test("boolean and inf constants", () => {
			const tokens = new Tokenizer("true false inf").tokenize();
			assert.strictEqual(tokens[0].kind, "True");
			assert.strictEqual(tokens[1].kind, "False");
			assert.strictEqual(tokens[2].kind, "Inf");
		});

		test("comment token", () => {
			const tokens = new Tokenizer("# this is a comment").tokenize();
			assert.strictEqual(tokens[0].kind, "Comment");
			assert.strictEqual(tokens[0].text, "# this is a comment");
		});
	});

	suite("semantic tokens provider", () => {
		test("tokenizes a simple member", () => {
			const src = "module main() -> (out: stereo number)";
			const tokens = new Tokenizer(src).tokenize();
			assert.strictEqual(tokens[0].kind, "Module");
			assert.strictEqual(tokens[1].kind, "Identifier");
			assert.strictEqual(tokens[1].text, "main");
		});

		test("filterTokens removes comments and eof", () => {
			const src = "x # comment\ny";
			const all = new Tokenizer(src).tokenize();
			const filtered = filterTokens(all);
			const kinds = filtered.map(t => t.kind);
			assert.ok(!kinds.includes("Comment"), "comments should be filtered");
			assert.strictEqual(kinds[kinds.length - 1], "Eof", "eof should be present");
		});

		test("parse after filter works", () => {
			const src = "module main() -> (out)\n  out = 1";
			const all = new Tokenizer(src).tokenize();
			const filtered = filterTokens(all);
			const ast = parseTokens(filtered);
			assert.strictEqual(ast.members.length, 1);
			assert.strictEqual(ast.members[0].name, "main");
		});
	});

	suite("legend", () => {
		test("legend includes custom Zing types", () => {
			assert.ok(semanticLegend.tokenTypes.includes("zingToplevel"));
			assert.ok(semanticLegend.tokenTypes.includes("zingToplevelModifier"));
			assert.ok(semanticLegend.tokenTypes.includes("zingScope"));
			assert.ok(semanticLegend.tokenTypes.includes("zingWidth"));
			assert.ok(semanticLegend.tokenTypes.includes("zingType"));
			assert.ok(semanticLegend.tokenTypes.includes("zingControl"));
			assert.ok(semanticLegend.tokenTypes.includes("supportFunction"));
		});

		test("legend includes built-in types", () => {
			assert.ok(semanticLegend.tokenTypes.includes("comment"));
			assert.ok(semanticLegend.tokenTypes.includes("string"));
			assert.ok(semanticLegend.tokenTypes.includes("number"));
			assert.ok(semanticLegend.tokenTypes.includes("operator"));
			assert.ok(semanticLegend.tokenTypes.includes("variable"));
			assert.ok(semanticLegend.tokenTypes.includes("function"));
			assert.ok(semanticLegend.tokenTypes.includes("parameter"));
		});

		test("legend uses declaration and static modifiers", () => {
			assert.ok(semanticLegend.tokenModifiers.includes("declaration"));
			assert.ok(semanticLegend.tokenModifiers.includes("static"));
		});

		test("type count matches indices", () => {
			assert.strictEqual(semanticLegend.tokenTypes.length, 14);
		});

		test("modifier count matches indices", () => {
			assert.strictEqual(semanticLegend.tokenModifiers.length, 2);
		});
	});

	suite("expression operator precedence", () => {
		function parseExpr(body: string): Expression {
			const src = `function f() -> (out)\n  ${body}`;
			const tokens = new Tokenizer(src).tokenize();
			const ast = parseTokens(tokens);
			assert.strictEqual(ast.members.length, 1, "should parse one member");
			assert.strictEqual(ast.members[0].body.length, 1, "should parse one statement");
			return ast.members[0].body[0].expression;
		}

		test("multiplication binds tighter than addition: a + b * c", () => {
			const expr = parseExpr("out = a + b * c");
			assert.strictEqual(expr.kind, "Binary");
			assert.strictEqual((expr as any).operator, "+");
			assert.strictEqual((expr as any).left.kind, "Variable");
			assert.strictEqual((expr as any).left.name, "a");
			assert.strictEqual((expr as any).right.kind, "Binary");
			assert.strictEqual((expr as any).right.operator, "*");
			assert.strictEqual((expr as any).right.left.name, "b");
			assert.strictEqual((expr as any).right.right.name, "c");
		});

		test("addition with parenthesized subtraction and multiplication: a + (b - a) * t.clamp01", () => {
			const expr = parseExpr("out = a + (b - a) * t.clamp01");
			assert.strictEqual(expr.kind, "Binary");
			assert.strictEqual((expr as any).operator, "+");
			assert.strictEqual((expr as any).left.kind, "Variable");
			assert.strictEqual((expr as any).left.name, "a");
			const right = (expr as any).right;
			assert.strictEqual(right.kind, "Binary");
			assert.strictEqual(right.operator, "*");
			assert.strictEqual(right.left.kind, "Tuple");
			const call = right.right;
			assert.strictEqual(call.kind, "Call");
			assert.strictEqual(call.name, "clamp01");
			assert.strictEqual(call.arguments[0].kind, "Variable");
			assert.strictEqual(call.arguments[0].name, "t");
		});

		test("left associativity of addition: a + b + c", () => {
			const expr = parseExpr("out = a + b + c");
			assert.strictEqual(expr.kind, "Binary");
			assert.strictEqual((expr as any).operator, "+");
			assert.strictEqual((expr as any).left.kind, "Binary");
			assert.strictEqual((expr as any).left.operator, "+");
			assert.strictEqual((expr as any).left.left.name, "a");
			assert.strictEqual((expr as any).left.right.name, "b");
			assert.strictEqual((expr as any).right.name, "c");
		});

		test("multiplication binds tighter than subtraction: a - b * c", () => {
			const expr = parseExpr("out = a - b * c");
			assert.strictEqual(expr.kind, "Binary");
			assert.strictEqual((expr as any).operator, "-");
			assert.strictEqual((expr as any).left.name, "a");
			assert.strictEqual((expr as any).right.kind, "Binary");
			assert.strictEqual((expr as any).right.operator, "*");
		});

		test("division binds tighter than addition: a + b / c", () => {
			const expr = parseExpr("out = a + b / c");
			assert.strictEqual(expr.kind, "Binary");
			assert.strictEqual((expr as any).operator, "+");
			assert.strictEqual((expr as any).right.kind, "Binary");
			assert.strictEqual((expr as any).right.operator, "/");
		});

		test("comparison binds tighter than logical and: a == b & c > d", () => {
			const expr = parseExpr("out = a == b & c > d");
			assert.strictEqual(expr.kind, "Binary");
			assert.strictEqual((expr as any).operator, "&");
			assert.strictEqual((expr as any).left.kind, "Binary");
			assert.strictEqual((expr as any).left.operator, "==");
			assert.strictEqual((expr as any).right.kind, "Binary");
			assert.strictEqual((expr as any).right.operator, ">");
		});

		test("conditional has lowest precedence: a ? b + c : d * e", () => {
			const expr = parseExpr("out = a ? b + c : d * e");
			assert.strictEqual(expr.kind, "Conditional");
			assert.strictEqual((expr as any).thenBranch.kind, "Binary");
			assert.strictEqual((expr as any).thenBranch.operator, "+");
			assert.strictEqual((expr as any).elseBranch.kind, "Binary");
			assert.strictEqual((expr as any).elseBranch.operator, "*");
		});

		test("unary minus binds tighter than multiplication: -a * b", () => {
			const expr = parseExpr("out = -a * b");
			assert.strictEqual(expr.kind, "Binary");
			assert.strictEqual((expr as any).operator, "*");
			assert.strictEqual((expr as any).left.kind, "Unary");
			assert.strictEqual((expr as any).left.operator, "-");
			assert.strictEqual((expr as any).right.name, "b");
		});

		test("complex mixed precedence: a + (b - a) * t.clamp01 does not break subsequent members", () => {
			const src = `function lerp(a, b, t) -> (out)\n  out = a + (b - a) * t.clamp01\n\nfunction mod1(a) -> (b)\n  b = a - floor(a)`;
			const tokens = new Tokenizer(src).tokenize();
			const ast = parseTokens(tokens);
			assert.strictEqual(ast.members.length, 2, "both functions must be parsed");
			assert.strictEqual(ast.members[0].name, "lerp");
			assert.strictEqual(ast.members[1].name, "mod1");
			assert.strictEqual(ast.parseErrors.length, 0, "no parse errors");
		});
	});
});
