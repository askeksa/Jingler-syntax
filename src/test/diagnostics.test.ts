import * as assert from "assert";
import * as vscode from "vscode";
import { computeDiagnostics } from "../diagnostics";

suite("Diagnostics Tests", () => {

	async function getDiagnostics(text: string): Promise<vscode.Diagnostic[]> {
		const doc = await vscode.workspace.openTextDocument({ language: "zing", content: text });
		return await computeDiagnostics(doc);
	}

	function diagMessages(diags: vscode.Diagnostic[]): string[] {
		return diags.map(d => d.message);
	}

	// --- Parser errors ---

	test("valid program has no diagnostics", async () => {
		const text = `module main -> (out)
  out = 1
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("parser error surfaces as diagnostic", async () => {
		const text = `module -> (out)
  out = 1
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("missing name")), `expected parse error, got: ${messages.join(", ")}`);
	});

	// --- Unresolved identifiers ---

	test("unresolved variable in expression", async () => {
		const text = `module main -> (out)
  out = nonexistent
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("nonexistent: unresolved identifier")), `expected unresolved, got: ${messages.join(", ")}`);
	});

	test("resolved input variable has no diagnostic", async () => {
		const text = `module main (x) -> (out)
  out = x
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("resolved output variable has no diagnostic", async () => {
		const text = `module main (x) -> (out)
  out = x * 2
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("resolved local variable has no diagnostic", async () => {
		const text = `module main -> (out)
  x = 1
  out = x
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("forward reference to local variable is flagged", async () => {
		const text = `module main -> (out)
  out = x
  x = 1
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("x: forward reference")), `expected x forward reference, got: ${messages.join(", ")}`);
	});

	test("forward reference to member is flagged", async () => {
		const text = `module main -> (out)
  out = helper(1)

module helper (x) -> (y)
  y = x
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("helper: forward reference")), `expected helper forward reference, got: ${messages.join(", ")}`);
	});

	test("forward reference inside cell is allowed", async () => {
		const text = `module main -> (out)
  out = cell(0, x)
  x = out + 1
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("forward reference inside delay is allowed", async () => {
		const text = `module main -> (out)
  out = delay(0, x)
  x = out + 1
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("for-loop variable used outside body is flagged", async () => {
		const text = `module main -> (out)
  x = for i to 10 add i
  out = i
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("i: iteration variable")), `expected i iteration variable error, got: ${messages.join(", ")}`);
	});

	test("for-loop variable inside cell is still scoped to for body", async () => {
		const text = `module main -> (out)
  x = for i to 10 add i
  out = cell(0, i)
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("i: iteration variable")), `expected i iteration variable error, got: ${messages.join(", ")}`);
	});

	test("forward reference to parameter is OK", async () => {
		const text = `parameter tempo 60 to 200 = 120
module main -> (out)
  out = tempo
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("resolved parameter has no diagnostic", async () => {
		const text = `parameter tempo 60 to 200 = 120
module main -> (out)
  out = tempo
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("resolved built-in function has no diagnostic", async () => {
		const text = `module main -> (out)
  out = sin(1)
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("resolved built-in module has no diagnostic", async () => {
		const text = `module main -> (out)
  out = cell(1, 0)
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("unknown function call is unresolved", async () => {
		const text = `module main -> (out)
  out = foobar(1)
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("foobar: unresolved identifier")), `expected unresolved, got: ${messages.join(", ")}`);
	});

	test("multiple unresolved identifiers each reported", async () => {
		const text = `module main -> (out)
  out = a + b
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("a: unresolved identifier")), `expected a unresolved, got: ${messages.join(", ")}`);
		assert.ok(messages.some(m => m.includes("b: unresolved identifier")), `expected b unresolved, got: ${messages.join(", ")}`);
	});

	test("unresolved in nested expression", async () => {
		const text = `module main -> (out)
  out = sin(unknown)
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("unknown: unresolved identifier")), `expected unresolved, got: ${messages.join(", ")}`);
	});

	test("ForExpr variable is a definition, not unresolved", async () => {
		const text = `module main -> (out)
  out = for i to 10 add i
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("assignment LHS is a definition, not unresolved", async () => {
		const text = `module main -> (out)
  x = 1
  out = x
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("resolved member call has no diagnostic", async () => {
		const text = `module helper (x) -> (y)
  y = x

module main -> (out)
  out = helper(1)
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("unresolved member call is reported", async () => {
		const text = `module main -> (out)
  out = missingModule(1)
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("missingModule: unresolved identifier")), `expected unresolved, got: ${messages.join(", ")}`);
	});

	// --- Include file not found ---

	test("include to nonexistent file is reported", async () => {
		const text = `include "this_does_not_exist_abc.zing"
module main -> (out)
  out = 1
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("file not found")), `expected file not found, got: ${messages.join(", ")}`);
	});

	// --- Severity ---

	test("diagnostics are Error severity", async () => {
		const text = `module main -> (out)
  out = noVar
`;
		const diags = await getDiagnostics(text);
		assert.ok(diags.length > 0);
		assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Error);
	});

	// --- Range ---

	test("diagnostic range covers the identifier", async () => {
		const text = `module main -> (out)
  out = badName
`;
		const diags = await getDiagnostics(text);
		assert.ok(diags.length > 0);
		const diag = diags[0];
		const word = diag.message.split(":")[0].trim();
		assert.strictEqual(diag.range.start.line, 1);
		assert.strictEqual(diag.range.end.character - diag.range.start.character, word.length);
	});

	test("unresolved in merge expression", async () => {
		const text = `module main -> (out)
  out = [leftCh, rightCh]
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("leftCh: unresolved identifier")), `expected leftCh unresolved, got: ${messages.join(", ")}`);
		assert.ok(messages.some(m => m.includes("rightCh: unresolved identifier")), `expected rightCh unresolved, got: ${messages.join(", ")}`);
	});

	test("unresolved in conditional expression", async () => {
		const text = `module main -> (out)
  out = cond ? thenVal : elseVal
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("cond: unresolved identifier")), `expected cond unresolved, got: ${messages.join(", ")}`);
		assert.ok(messages.some(m => m.includes("thenVal: unresolved identifier")), `expected thenVal unresolved, got: ${messages.join(", ")}`);
		assert.ok(messages.some(m => m.includes("elseVal: unresolved identifier")), `expected elseVal unresolved, got: ${messages.join(", ")}`);
	});

	test("unresolved in buffer literal", async () => {
		const text = `module main -> (out)
  out = {x, y, z}
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("x: unresolved identifier")), `expected x unresolved, got: ${messages.join(", ")}`);
		assert.ok(messages.some(m => m.includes("y: unresolved identifier")), `expected y unresolved, got: ${messages.join(", ")}`);
		assert.ok(messages.some(m => m.includes("z: unresolved identifier")), `expected z unresolved, got: ${messages.join(", ")}`);
	});

	test("unresolved in buffer index", async () => {
		const text = `module main -> (out)
  out = myBuf[myIdx]
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("myBuf: unresolved identifier")), `expected myBuf unresolved, got: ${messages.join(", ")}`);
		assert.ok(messages.some(m => m.includes("myIdx: unresolved identifier")), `expected myIdx unresolved, got: ${messages.join(", ")}`);
	});

	test("unresolved in tuple expression", async () => {
		const text = `module main -> (out)
  out = (a, b, c)
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("a: unresolved identifier")), `expected a unresolved, got: ${messages.join(", ")}`);
		assert.ok(messages.some(m => m.includes("b: unresolved identifier")), `expected b unresolved, got: ${messages.join(", ")}`);
		assert.ok(messages.some(m => m.includes("c: unresolved identifier")), `expected c unresolved, got: ${messages.join(", ")}`);
	});

	test("unresolved in unary expression", async () => {
		const text = `module main -> (out)
  out = -negVal
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("negVal: unresolved identifier")), `expected negVal unresolved, got: ${messages.join(", ")}`);
	});

	test("unresolved in logical not expression", async () => {
		const text = `module main -> (out)
  out = !flag
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("flag: unresolved identifier")), `expected flag unresolved, got: ${messages.join(", ")}`);
	});

	test("resolved in buffer init expression", async () => {
		const text = `module main -> (out)
  out = for 1024 buffer sin(1)
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});

	test("unresolved in buffer init expression", async () => {
		const text = `module main -> (out)
  out = for badLen buffer sin(1)
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("badLen: unresolved identifier")), `expected badLen unresolved, got: ${messages.join(", ")}`);
	});

	test("method-style call produces parse error (dot notation not supported)", async () => {
		const text = `module main -> (out)
  x = 1
  out = x.unknownMethod()
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("unexpected token")), `expected parse error, got: ${messages.join(", ")}`);
	});

	// --- Duplicate detection ---

	test("duplicate member name is flagged", async () => {
		const text = `module main -> (out)
  out = 1

module main -> (out2)
  out2 = 2
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("Duplicate definition of 'main'")), `expected duplicate member, got: ${messages.join(", ")}`);
	});

	test("duplicate parameter name is flagged", async () => {
		const text = `parameter tempo 60 to 200 = 120
parameter tempo 60 to 200 = 60

module main -> (out)
  out = 1
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("Duplicate definition of 'tempo'")), `expected duplicate param, got: ${messages.join(", ")}`);
	});

	test("duplicate input name is flagged", async () => {
		const text = `module main (x, x) -> (out)
  out = x
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("Duplicate definition of 'x'")), `expected duplicate input, got: ${messages.join(", ")}`);
	});

	test("duplicate output name is flagged", async () => {
		const text = `module main (x) -> (out, out)
  out = x
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("Duplicate definition of 'out'")), `expected duplicate output, got: ${messages.join(", ")}`);
	});

	test("duplicate local variable is flagged", async () => {
		const text = `module main -> (out)
  x = 1
  x = 2
  out = x
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("Duplicate definition of 'x'")), `expected duplicate variable, got: ${messages.join(", ")}`);
	});

	test("duplicate MIDI input is flagged", async () => {
		const text = `instrument kick:: snare:: kick:: piano -> (out)
  out = 1
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("Duplicate MIDI input 'kick'")), `expected duplicate MIDI, got: ${messages.join(", ")}`);
	});

	test("member shadowing built-in is flagged", async () => {
		const text = `module sin (x) -> (result)
  result = x
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("has the same name as a built-in")), `expected built-in shadow, got: ${messages.join(", ")}`);
	});

	test("parameter shadowing built-in is flagged", async () => {
		const text = `parameter sin 0 to 1 = 0.5

module main -> (out)
  out = 1
`;
		const diags = await getDiagnostics(text);
		const messages = diagMessages(diags);
		assert.ok(messages.some(m => m.includes("has the same name as a built-in")), `expected built-in shadow, got: ${messages.join(", ")}`);
	});

	test("output assigned in body is not a duplicate", async () => {
		const text = `module main (x) -> (out)
  out = x * 2
`;
		const diags = await getDiagnostics(text);
		assert.strictEqual(diags.length, 0);
	});
});
