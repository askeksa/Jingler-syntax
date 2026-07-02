import * as assert from "assert";
import * as vscode from "vscode";
import { parseZingDocument, isSymbolStartCharacter, isSymbolMiddleCharacter } from "../document_symbols";

suite("Document Symbols Tests", () => {
	test("isSymbolStartCharacter returns true for valid starts", () => {
		assert.strictEqual(isSymbolStartCharacter("a"), true);
		assert.strictEqual(isSymbolStartCharacter("Z"), true);
		assert.strictEqual(isSymbolStartCharacter("_"), true);
		assert.strictEqual(isSymbolStartCharacter("0"), false);
		assert.strictEqual(isSymbolStartCharacter("-"), false);
	});

	test("isSymbolMiddleCharacter includes digits", () => {
		assert.strictEqual(isSymbolMiddleCharacter("a"), true);
		assert.strictEqual(isSymbolMiddleCharacter("9"), true);
		assert.strictEqual(isSymbolMiddleCharacter(" "), false);
	});

	test("parseZingDocument extracts module declarations", () => {
		const uri = vscode.Uri.file("/tmp/test.zing");
		const doc = parseZingDocument("module MyModule", uri);
		assert.strictEqual(doc.symbols.length, 1);
		assert.strictEqual(doc.symbols[0].name, "MyModule");
	});

	test("parseZingDocument extracts function declarations", () => {
		const uri = vscode.Uri.file("/tmp/test.zing");
		const doc = parseZingDocument("function myFunc", uri);
		assert.strictEqual(doc.symbols.length, 1);
		assert.strictEqual(doc.symbols[0].name, "myFunc");
	});

	test("parseZingDocument extracts instrument declarations", () => {
		const uri = vscode.Uri.file("/tmp/test.zing");
		const doc = parseZingDocument("instrument piano", uri);
		assert.strictEqual(doc.symbols.length, 1);
		assert.strictEqual(doc.symbols[0].name, "piano");
	});

	test("parseZingDocument handles :: namespace syntax", () => {
		const uri = vscode.Uri.file("/tmp/test.zing");
		const doc = parseZingDocument("module Foo::Bar::Baz", uri);
		assert.strictEqual(doc.symbols.length, 1);
		assert.strictEqual(doc.symbols[0].name, "Baz");
	});

	test("parseZingDocument extracts include directives", () => {
		const uri = vscode.Uri.file("/tmp/test.zing");
		const doc = parseZingDocument('include "other.zing"', uri);
		assert.strictEqual(doc.includes.length, 1);
		assert.strictEqual(doc.includes[0], "other.zing");
	});

	test("parseZingDocument skips commented lines", () => {
		const uri = vscode.Uri.file("/tmp/test.zing");
		const doc = parseZingDocument("# module ignored", uri);
		assert.strictEqual(doc.symbols.length, 0);
	});

	test("parseZingDocument handles multiple declarations", () => {
		const uri = vscode.Uri.file("/tmp/test.zing");
		const doc = parseZingDocument("function foo\nmodule bar\ninstrument baz", uri);
		assert.strictEqual(doc.symbols.length, 3);
		assert.strictEqual(doc.symbols[0].name, "foo");
		assert.strictEqual(doc.symbols[1].name, "bar");
		assert.strictEqual(doc.symbols[2].name, "baz");
	});
});
