import * as assert from "assert";
import { Tokenizer, Token, TokenKind } from "../tokenizer";

function kinds(tokens: Token[]): TokenKind[] {
	return tokens.map(t => t.kind);
}

function texts(tokens: Token[]): string[] {
	return tokens.map(t => t.text);
}

suite("Tokenizer", () => {
	suite("keywords", () => {
		test("each keyword produces correct kind", () => {
			const kw: [string, TokenKind][] = [
				["include", "Include"], ["parameter", "Parameter"], ["to", "To"],
				["global", "Global"], ["note", "Note"],
				["module", "Module"], ["function", "Function"], ["instrument", "Instrument"],
				["for", "For"], ["buffer", "Buffer"],
				["static", "Static"], ["dynamic", "Dynamic"],
				["mono", "Mono"], ["stereo", "Stereo"], ["generic", "Generic"],
				["number", "NumberKw"], ["bool", "BoolKw"],
				["inf", "Inf"],
			];
			for (const [word, expected] of kw) {
				const tokens = new Tokenizer(word).tokenize();
				assert.strictEqual(tokens[0].kind, expected, `keyword: ${word}`);
				assert.strictEqual(tokens[0].text, word);
				assert.strictEqual(tokens[0].line, 0);
				assert.strictEqual(tokens[0].character, 0);
			}
		});
	});

	suite("booleans", () => {
		test("true and false", () => {
			const tokens = new Tokenizer("true false").tokenize();
			assert.deepStrictEqual(kinds(tokens), ["True", "False", "Eof"]);
		});
	});

	suite("identifiers", () => {
		test("simple identifiers", () => {
			const tokens = new Tokenizer("myVar _foo x123").tokenize();
			assert.deepStrictEqual(kinds(tokens), ["Identifier", "Identifier", "Identifier", "Eof"]);
			assert.deepStrictEqual(texts(tokens), ["myVar", "_foo", "x123", ""]);
		});

		test("identifier line/character", () => {
			const tokens = new Tokenizer("  x").tokenize();
			assert.strictEqual(tokens[0].kind, "Identifier");
			assert.strictEqual(tokens[0].character, 2);
			assert.strictEqual(tokens[0].line, 0);
		});
	});

	suite("numbers", () => {
		test("integer", () => {
			const tokens = new Tokenizer("42").tokenize();
			assert.strictEqual(tokens[0].kind, "Decimal");
			assert.strictEqual(tokens[0].text, "42");
		});

		test("decimal", () => {
			const tokens = new Tokenizer("3.14").tokenize();
			assert.strictEqual(tokens[0].kind, "Decimal");
			assert.strictEqual(tokens[0].text, "3.14");
		});

		test("hex number", () => {
			const tokens = new Tokenizer("0x1A").tokenize();
			assert.strictEqual(tokens[0].kind, "Hex");
			assert.strictEqual(tokens[0].text, "0x1A");
		});

		test("hex with fraction", () => {
			const tokens = new Tokenizer("0x1A.F").tokenize();
			assert.strictEqual(tokens[0].kind, "Hex");
			assert.strictEqual(tokens[0].text, "0x1A.F");
		});

		test("inf keyword", () => {
			const tokens = new Tokenizer("inf").tokenize();
			assert.strictEqual(tokens[0].kind, "Inf");
		});
	});

	suite("strings", () => {
		test("double-quoted string", () => {
			const tokens = new Tokenizer('"path/to/file.zing"').tokenize();
			assert.strictEqual(tokens[0].kind, "String");
			assert.strictEqual(tokens[0].text, '"path/to/file.zing"');
		});

		test("empty string", () => {
			const tokens = new Tokenizer('""').tokenize();
			assert.strictEqual(tokens[0].kind, "String");
			assert.strictEqual(tokens[0].text, '""');
		});
	});

	suite("operators", () => {
		test("single-char operators", () => {
			const tokens = new Tokenizer("+ - * / = < > | ^ & ? : . !").tokenize();
			assert.deepStrictEqual(
				kinds(tokens),
				["Plus", "Minus", "Multiply", "Divide", "Assign", "Less", "Greater",
					"Or", "Xor", "And", "Question", "Colon", "Dot", "Not", "Eof"]
			);
		});

		test("two-char operators", () => {
			const tokens = new Tokenizer("== != <= >= ::").tokenize();
			assert.deepStrictEqual(kinds(tokens), ["Eq", "Neq", "LessEq", "GreaterEq", "ColonColon", "Eof"]);
		});

		test("minus-plus", () => {
			const tokens = new Tokenizer("-+").tokenize();
			assert.strictEqual(tokens[0].kind, "MinusPlus");
		});

		test("arrow", () => {
			const tokens = new Tokenizer("->").tokenize();
			assert.strictEqual(tokens[0].kind, "Arrow");
		});
	});

	suite("delimiters", () => {
		test("all delimiters", () => {
			const tokens = new Tokenizer("( ) [ ] { } ,").tokenize();
			assert.deepStrictEqual(
				kinds(tokens),
				["LParen", "RParen", "LSquare", "RSquare", "LBrace", "RBrace", "Comma", "Eof"]
			);
		});
	});

	suite("comments", () => {
		test("hash comment removed", () => {
			const tokens = new Tokenizer("x # this is a comment\ny").tokenize();
			assert.deepStrictEqual(kinds(tokens), ["Identifier", "Identifier", "Eof"]);
			assert.deepStrictEqual(texts(tokens), ["x", "y", ""]);
		});

		test("sharp in note name is not a comment", () => {
			const tokens = new Tokenizer("C#4 x").tokenize();
			assert.deepStrictEqual(kinds(tokens), ["Identifier", "Identifier", "Decimal", "Identifier", "Eof"]);
			assert.deepStrictEqual(texts(tokens), ["C", "#", "4", "x", ""]);
		});

		test("sharp followed by non-digit is comment", () => {
			const tokens = new Tokenizer("C#x").tokenize();
			assert.strictEqual(tokens[0].kind, "Identifier");
			assert.strictEqual(tokens[0].text, "C");
		});

		test("trailing sharp at end of line is comment", () => {
			const tokens = new Tokenizer("G#").tokenize();
			assert.strictEqual(tokens[0].kind, "Identifier");
			assert.strictEqual(tokens[0].text, "G");
		});

		test("multiple note sharps then comment", () => {
			const tokens = new Tokenizer("C#4 D#3 # comment").tokenize();
			assert.strictEqual(tokens[0].text, "C");
			assert.strictEqual(tokens[1].text, "#");
			assert.strictEqual(tokens[2].text, "4");
			assert.strictEqual(tokens[3].text, "D");
			assert.strictEqual(tokens[4].text, "#");
			assert.strictEqual(tokens[5].text, "3");
		});
	});

	suite("MIDI mappings", () => {
		test("channel only", () => {
			const tokens = new Tokenizer("1::").tokenize();
			assert.strictEqual(tokens[0].kind, "MidiMapping");
			assert.strictEqual(tokens[0].text, "1::");
		});

		test("channel with single note", () => {
			const tokens = new Tokenizer("1{C4}::").tokenize();
			assert.strictEqual(tokens[0].kind, "MidiMapping");
			assert.strictEqual(tokens[0].text, "1{C4}::");
		});

		test("channel with range", () => {
			const tokens = new Tokenizer("1{C4..G5}::").tokenize();
			assert.strictEqual(tokens[0].kind, "MidiMapping");
			assert.strictEqual(tokens[0].text, "1{C4..G5}::");
		});

		test("channel with range and transpose", () => {
			const tokens = new Tokenizer("1{C4..G5 / C3}::").tokenize();
			assert.strictEqual(tokens[0].kind, "MidiMapping");
			assert.strictEqual(tokens[0].text, "1{C4..G5 / C3}::");
		});

		test("channel with sharp notes", () => {
			const tokens = new Tokenizer("1{C#4..G#5}::").tokenize();
			assert.strictEqual(tokens[0].kind, "MidiMapping");
			assert.strictEqual(tokens[0].text, "1{C#4..G#5}::");
		});

		test("named mapping", () => {
			const tokens = new Tokenizer("kick::").tokenize();
			assert.strictEqual(tokens[0].kind, "MidiMapping");
			assert.strictEqual(tokens[0].text, "kick::");
		});

		test("bare number without :: is not MIDI", () => {
			const tokens = new Tokenizer("42").tokenize();
			assert.strictEqual(tokens[0].kind, "Decimal");
			assert.strictEqual(tokens[0].text, "42");
		});

		test("bare identifier without :: is not MIDI", () => {
			const tokens = new Tokenizer("myVar").tokenize();
			assert.strictEqual(tokens[0].kind, "Identifier");
			assert.strictEqual(tokens[0].text, "myVar");
		});
	});

	suite("line/character", () => {
		test("positions across multiple tokens", () => {
			const tokens = new Tokenizer("a + b").tokenize();
			assert.strictEqual(tokens[0].line, 0);
			assert.strictEqual(tokens[0].character, 0); // a
			assert.strictEqual(tokens[1].line, 0);
			assert.strictEqual(tokens[1].character, 2); // +
			assert.strictEqual(tokens[2].line, 0);
			assert.strictEqual(tokens[2].character, 4); // b
		});

		test("position after newline", () => {
			const tokens = new Tokenizer("x\ny").tokenize();
			assert.strictEqual(tokens[0].line, 0);
			assert.strictEqual(tokens[0].character, 0); // x
			assert.strictEqual(tokens[1].line, 1);
			assert.strictEqual(tokens[1].character, 0); // y
		});

		test("position after comment", () => {
			const tokens = new Tokenizer("# comment\nx").tokenize();
			assert.strictEqual(tokens[0].kind, "Identifier");
			assert.strictEqual(tokens[0].line, 1);
			assert.strictEqual(tokens[0].character, 0);
		});
	});

	suite("eof", () => {
		test("eof token present", () => {
			const tokens = new Tokenizer("x").tokenize();
			assert.strictEqual(tokens[tokens.length - 1].kind, "Eof");
		});

		test("eof line/character", () => {
			const tokens = new Tokenizer("hello\n").tokenize();
			const eof = tokens[tokens.length - 1];
			assert.strictEqual(eof.kind, "Eof");
			assert.strictEqual(eof.line, 1);
			assert.strictEqual(eof.character, 0);
		});

		test("empty source produces only eof", () => {
			const tokens = new Tokenizer("").tokenize();
			assert.deepStrictEqual(kinds(tokens), ["Eof"]);
			assert.strictEqual(tokens[0].line, 0);
			assert.strictEqual(tokens[0].character, 0);
		});
	});

	suite("integration", () => {
		test("member declaration tokens", () => {
			const src = "global module main() -> (out: stereo number)";
			const tokens = new Tokenizer(src).tokenize();
			const expectedKinds = [
				"Global", "Module", "Identifier",
				"LParen", "RParen",
				"Arrow",
				"LParen", "Identifier", "Colon", "Stereo", "NumberKw", "RParen",
				"Eof",
			];
			assert.deepStrictEqual(kinds(tokens), expectedKinds);
		});

		test("assignment statement tokens", () => {
			const src = "x = a + b * 2";
			const tokens = new Tokenizer(src).tokenize();
			assert.deepStrictEqual(kinds(tokens), [
				"Identifier", "Assign",
				"Identifier", "Plus", "Identifier", "Multiply", "Decimal",
				"Eof",
			]);
		});

		test("include directive tokens", () => {
			const src = 'include "other.zing"';
			const tokens = new Tokenizer(src).tokenize();
			assert.deepStrictEqual(kinds(tokens), ["Include", "String", "Eof"]);
		});

		test("parameter declaration tokens", () => {
			const src = "parameter tempo 60 to 200 = 120";
			const tokens = new Tokenizer(src).tokenize();
			assert.deepStrictEqual(kinds(tokens), [
				"Parameter", "Identifier", "Decimal", "To", "Decimal", "Assign", "Decimal",
				"Eof",
			]);
		});
	});
});
