import * as assert from "assert";
import * as vscode from "vscode";
import { hoverProvider } from "../hover";

suite("Hover Tests", () => {

	async function hoverOn(text: string, cursorLine: number, cursorChar: number): Promise<string | null> {
		const doc = await vscode.workspace.openTextDocument({ language: "zing", content: text });
		const tokenSource = new vscode.CancellationTokenSource();
		const hover = await hoverProvider.provideHover(doc, new vscode.Position(cursorLine, cursorChar), tokenSource.token);
		tokenSource.dispose();
		if (!hover || hover.contents.length === 0) return null;
		const first = hover.contents[0];
		if (typeof first === "string") return first;
		if ("value" in first) return first.value;
		return String(first);
	}

	test("hover on module name shows signature", async () => {
		const text = `module MyModule (x: static mono number) -> (y: dynamic stereo number)
  y = x + 1
`;
		const content = await hoverOn(text, 0, 7);
		assert.ok(content != null);
		assert.ok(content.includes("**module**"));
		assert.ok(content.includes("`MyModule`"));
	});

	test("hover on function name shows signature", async () => {
		const text = `function Foo (a, b) -> (c)
  c = a * b
`;
		const content = await hoverOn(text, 0, 9);
		assert.ok(content != null);
		assert.ok(content.includes("**function**"));
		assert.ok(content.includes("`Foo`"));
	});

	test("hover on instrument name shows signature", async () => {
		const text = `instrument piano (note) -> (output)
  output = note * 0.5
`;
		const content = await hoverOn(text, 0, 11);
		assert.ok(content != null);
		assert.ok(content.includes("**instrument**"));
		assert.ok(content.includes("`piano`"));
	});

	test("hover on parameter shows range and default", async () => {
		const text = `parameter tempo 60 to 200 = 120
module main -> (out)
  out = tempo
`;
		const content = await hoverOn(text, 2, 8);
		assert.ok(content != null);
		assert.ok(content.includes("**parameter**"));
		assert.ok(content.includes("`tempo`"));
		assert.ok(content.includes("60 to 200"));
		assert.ok(content.includes("= 120"));
	});

	test("hover on local variable shows assignment", async () => {
		const text = `module MyModule (x) -> (y)
  y = x + 1
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("**variable**"));
		assert.ok(content.includes("`y`"));
		assert.ok(content.includes("assigned"));
		assert.ok(content.includes("`x`"));
	});

	test("hover on input parameter in body", async () => {
		const text = `module MyModule (x: static mono number) -> (y)
  y = x + 1
`;
		const content = await hoverOn(text, 1, 6);
		assert.ok(content != null);
		assert.ok(content.includes("**parameter**"));
		assert.ok(content.includes("`x`"));
	});

	test("hover on built-in function", async () => {
		const text = `module main -> (out)
  out = sin(0.5)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("**function**"));
		assert.ok(content.includes("`sin`"));
		assert.ok(content.includes("mono"));
	});

	test("hover on built-in module", async () => {
		const text = `module main -> (out)
  out = cell(0, 1)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("**module**"));
		assert.ok(content.includes("`cell`"));
		assert.ok(content.includes("typeless"));
	});

	test("hover on unknown symbol returns null", async () => {
		const text = `module main -> (out)
  out = unknownSymbol
`;
		const content = await hoverOn(text, 1, 8);
		assert.strictEqual(content, null);
	});

	test("hover on number literal returns null", async () => {
		const text = `module main -> (out)
  out = 42
`;
		const content = await hoverOn(text, 1, 8);
		assert.strictEqual(content, null);
	});

	test("hover on variable in expression shows assignment", async () => {
		const text = `module main (a) -> (c)
  b = a * 2
  c = b + 1
`;
		const content = await hoverOn(text, 2, 6);
		assert.ok(content != null);
		assert.ok(content.includes("**variable**"));
		assert.ok(content.includes("`b`"));
		assert.ok(content.includes("`a`"));
	});

	test("hover on output parameter in body (assignment LHS takes priority)", async () => {
		const text = `module MyModule (x) -> (y: dynamic stereo number)
  y = x
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("**variable**"));
		assert.ok(content.includes("`y`"));
	});

	test("hover with type annotations in signature", async () => {
		const text = `module MyModule (x: static mono number) -> (y: dynamic stereo number)
  y = x
`;
		const content = await hoverOn(text, 0, 7);
		assert.ok(content != null);
		assert.ok(content.includes("static"));
		assert.ok(content.includes("mono"));
		assert.ok(content.includes("number"));
		assert.ok(content.includes("dynamic"));
		assert.ok(content.includes("stereo"));
	});

	test("hover on parameter with no default", async () => {
		const text = `parameter tempo 60 to 200
module main -> (out)
  out = tempo
`;
		const content = await hoverOn(text, 2, 8);
		assert.ok(content != null);
		assert.ok(content.includes("60 to 200"));
		assert.ok(!content.includes("="));
	});

	test("hover on complex expression assignment", async () => {
		const text = `module main (a, b) -> (c)
  c = a + b * 2
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("assigned"));
		assert.ok(content.includes("`a`"));
		assert.ok(content.includes("`b`"));
	});

	test("hover on call expression in assignment", async () => {
		const text = `function bar (x) -> (r)
  r = x

module main -> (out)
  out = bar(1)
`;
		const content = await hoverOn(text, 4, 8);
		assert.ok(content != null);
		assert.ok(content.includes("**function**"));
		assert.ok(content.includes("`bar`"));
	});

	test("hover on merge expression", async () => {
		const text = `module main (a, b) -> (c)
  c = [a, b]
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("[`a`, `b`]"));
	});

	test("hover on conditional expression", async () => {
		const text = `module main (a, b) -> (c)
  c = a ? b : 0
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("?"));
		assert.ok(content.includes(":"));
	});

	test("hover on for expression", async () => {
		const text = `module main (n) -> (c)
  c = for i to n add i
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("for i to"));
		assert.ok(content.includes("add"));
	});

	test("hover on buffer literal", async () => {
		const text = `module main -> (c)
  c = {1, 2, 3}
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("{1, 2, 3}"));
	});

	test("hover on tuple index", async () => {
		const text = `module main (t) -> (c)
  c = t.0
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes(".0"));
	});

	test("hover on buffer index", async () => {
		const text = `module main (b, i) -> (c)
  c = b[i]
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("[`i`]"));
	});

	test("hover on unary negation", async () => {
		const text = `module main (x) -> (c)
  c = -x
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("-`x`"));
	});

	test("hover on unary logical not", async () => {
		const text = `module main (x) -> (c)
  c = !x
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("!`x`"));
	});

	test("hover on method-style call (Call expression)", async () => {
		const text = `module main (result) -> (c)
  c = result.process(1)
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("`process`("));
		assert.ok(content.includes("`result`"));
	});

	test("hover on gate built-in with description", async () => {
		const text = `instrument test -> (out)
  out = gate()
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("gate"));
		assert.ok(content.includes("gate status"));
	});

	test("hover on velocity built-in with description", async () => {
		const text = `instrument test -> (out)
  out = velocity()
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("velocity"));
		assert.ok(content.includes("Note velocity"));
	});

	test("hover on cell built-in with description", async () => {
		const text = `module main -> (out)
  out = cell(0, 1)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("cell"));
		assert.ok(content.includes("Stateful value"));
	});

	test("hover on delay built-in with description", async () => {
		const text = `module main (x) -> (out)
  out = delay(x, 44100)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("delay"));
		assert.ok(content.includes("Fixed delay"));
	});

	test("hover on dyndelay built-in with description", async () => {
		const text = `module main (x) -> (out)
  out = dyndelay(x, 100, 44100)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("dyndelay"));
		assert.ok(content.includes("Variable delay"));
	});

	test("hover on sincos built-in", async () => {
		const text = `module main -> (out)
  out = sincos(0.5)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("sincos"));
		assert.ok(content.includes("Sine and cosine"));
	});

	test("hover on random built-in", async () => {
		const text = `module main -> (out)
  out = random(0, 1)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("random"));
		assert.ok(content.includes("Random in range"));
	});

	test("hover on samplerate built-in", async () => {
		const text = `module main -> (out)
  out = samplerate()
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("samplerate"));
		assert.ok(content.includes("Sample rate"));
	});

	test("hover on key built-in", async () => {
		const text = `instrument test -> (out)
  out = key()
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("key"));
		assert.ok(content.includes("MIDI note number"));
	});

	test("hover on center built-in", async () => {
		const text = `module main (x) -> (out)
  out = center(x)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("center"));
		assert.ok(content.includes("Center channel"));
	});

	test("hover on swap built-in", async () => {
		const text = `module main (x) -> (out)
  out = swap(x)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("swap"));
		assert.ok(content.includes("Swap channels"));
	});

	test("hover on pow built-in", async () => {
		const text = `module main -> (out)
  out = pow(2, 3)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("pow"));
		assert.ok(content.includes("Power"));
	});

	test("hover on gmdls built-in", async () => {
		const text = `module main -> (out)
  out = gmdls(1, 0)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("gmdls"));
		assert.ok(content.includes("GM DLS"));
	});

	test("hover on index built-in", async () => {
		const text = `module main (b) -> (out)
  out = index(b)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("index"));
		assert.ok(content.includes("Buffer indexing"));
	});

	test("hover on left built-in", async () => {
		const text = `module main (x) -> (out)
  out = left(x)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("left"));
		assert.ok(content.includes("Left channel"));
	});

	test("hover on right built-in", async () => {
		const text = `module main (x) -> (out)
  out = right(x)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("right"));
		assert.ok(content.includes("Right channel"));
	});

	test("hover on log2 built-in", async () => {
		const text = `module main -> (out)
  out = log2(8)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("log2"));
	});

	test("hover on exp2 built-in", async () => {
		const text = `module main -> (out)
  out = exp2(3)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("exp2"));
	});

	test("hover on ceil built-in", async () => {
		const text = `module main -> (out)
  out = ceil(1.5)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("ceil"));
	});

	test("hover on floor built-in", async () => {
		const text = `module main -> (out)
  out = floor(1.5)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("floor"));
	});

	test("hover on round built-in", async () => {
		const text = `module main -> (out)
  out = round(1.5)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("round"));
	});

	test("hover on trunc built-in", async () => {
		const text = `module main -> (out)
  out = trunc(1.5)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("trunc"));
	});

	test("hover on sqrt built-in", async () => {
		const text = `module main -> (out)
  out = sqrt(4)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("sqrt"));
	});

	test("hover on tan built-in", async () => {
		const text = `module main -> (out)
  out = tan(0.5)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("tan"));
	});

	test("hover on cos built-in", async () => {
		const text = `module main -> (out)
  out = cos(0.5)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("cos"));
	});

	test("hover on atan2 built-in", async () => {
		const text = `module main -> (out)
  out = atan2(1, 0)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("atan2"));
	});

	test("hover on max built-in", async () => {
		const text = `module main -> (out)
  out = max(1, 2)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("max"));
	});

	test("hover on min built-in", async () => {
		const text = `module main -> (out)
  out = min(1, 2)
`;
		const content = await hoverOn(text, 1, 8);
		assert.ok(content != null);
		assert.ok(content.includes("min"));
	});

	test("hover on empty module inputs", async () => {
		const text = `module main () -> (out)
  out = 1
`;
		const content = await hoverOn(text, 0, 7);
		assert.ok(content != null);
		assert.ok(content.includes("()"));
	});

	test("hover on multi-input signature", async () => {
		const text = `module main (a, b, c) -> (d, e)
  d = a
  e = b + c
`;
		const content = await hoverOn(text, 0, 7);
		assert.ok(content != null);
		assert.ok(content.includes("`a`"));
		assert.ok(content.includes("`b`"));
		assert.ok(content.includes("`c`"));
		assert.ok(content.includes("`d`"));
		assert.ok(content.includes("`e`"));
	});

	test("hover on buffer init expression", async () => {
		const text = `module main -> (c)
  c = for 1024 buffer sin(0)
`;
		const content = await hoverOn(text, 1, 2);
		assert.ok(content != null);
		assert.ok(content.includes("for 1024"));
		assert.ok(content.includes("buffer"));
	});
});
