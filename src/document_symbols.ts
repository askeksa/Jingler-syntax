import * as vscode from 'vscode';
import { Tokenizer } from "./tokenizer";
import { parseTokens } from "./parser";
import { Program, Member, Parameter, Statement, PatternItem } from "./ast";

export class ZingDocument {
	symbols: vscode.SymbolInformation[];
	definitions: vscode.SymbolInformation[];
	definitionRanges: SymbolDefinition[];
	includes: string[];
	uri: vscode.Uri;
	ast: Program;

	constructor(uri: vscode.Uri, ast: Program) {
		this.uri = uri;
		this.ast = ast;
		this.symbols = [];
		this.definitions = [];
		this.definitionRanges = [];
		this.includes = [];
	}
}

export interface SymbolDefinition {
	name: string;
	nameRange: vscode.Range;
	fullRange: vscode.Range;
	uri: vscode.Uri;
}

export function isSymbolStartCharacter(ch: string) {
	return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch == "_";
}

export function isSymbolMiddleCharacter(ch: string) {
	return isSymbolStartCharacter(ch) || (ch >= "0" && ch <= "9");
}

/* ------------------------------------------------------------------ */
/*  Range construction helpers                                         */
/* ------------------------------------------------------------------ */

function makeRange(position: { line: number; character: number; endLine?: number; endCharacter?: number }, fallbackLength: number): vscode.Range {
	const start = new vscode.Position(position.line, position.character);
	const end = position.endLine != undefined
		? new vscode.Position(position.endLine, position.endCharacter!)
		: new vscode.Position(position.line, position.character + fallbackLength);
	return new vscode.Range(start, end);
}

/* ------------------------------------------------------------------ */
/*  Symbol factories                                                   */
/* ------------------------------------------------------------------ */

function toSymbol(name: string, kind: vscode.SymbolKind, position: { line: number; character: number; endLine?: number; endCharacter?: number }, uri: vscode.Uri): vscode.SymbolInformation {
	return new vscode.SymbolInformation(
		name,
		kind,
		"",
		new vscode.Location(uri, makeRange(position, name.length))
	);
}

function toSymbolDef(name: string, _kind: vscode.SymbolKind, namePosition: { line: number; character: number; endLine?: number; endCharacter?: number }, fullPosition: { line: number; character: number; endLine?: number; endCharacter?: number }, uri: vscode.Uri): SymbolDefinition {
	return {
		name,
		nameRange: makeRange(namePosition, name.length),
		fullRange: makeRange(fullPosition, name.length),
		uri,
	};
}

/* ------------------------------------------------------------------ */
/*  Collectors                                                         */
/* ------------------------------------------------------------------ */

function collectFromPatternItem(item: PatternItem, uri: vscode.Uri): { symbol: vscode.SymbolInformation; defRange: SymbolDefinition } {
	return {
		symbol: toSymbol(item.name, vscode.SymbolKind.Variable, item.position, uri),
		defRange: toSymbolDef(item.name, vscode.SymbolKind.Variable, item.position, item.position, uri),
	};
}

function collectFromStatement(stmt: Statement, uri: vscode.Uri): { symbols: vscode.SymbolInformation[]; defRanges: SymbolDefinition[] } {
	const symbols: vscode.SymbolInformation[] = [];
	const defRanges: SymbolDefinition[] = [];
	for (const item of stmt.pattern) {
		if (item.name) {
			const s = toSymbol(item.name, vscode.SymbolKind.Variable, item.position, uri);
			const d = toSymbolDef(item.name, vscode.SymbolKind.Variable, item.position, stmt.position, uri);
			symbols.push(s);
			defRanges.push(d);
		}
	}
	return { symbols, defRanges };
}

function collectFromParameter(param: Parameter, uri: vscode.Uri): { symbol: vscode.SymbolInformation; defRange: SymbolDefinition } {
	return {
		symbol: toSymbol(param.name, vscode.SymbolKind.Constant, param.namePosition, uri),
		defRange: toSymbolDef(param.name, vscode.SymbolKind.Constant, param.namePosition, param.position, uri),
	};
}

function collectFromMember(member: Member, uri: vscode.Uri): { symbols: vscode.SymbolInformation[]; defRanges: SymbolDefinition[] } {
	const symbols: vscode.SymbolInformation[] = [];
	const defRanges: SymbolDefinition[] = [];

	if (member.name) {
		symbols.push(toSymbol(member.name, vscode.SymbolKind.Function, member.namePosition, uri));
		defRanges.push(toSymbolDef(member.name, vscode.SymbolKind.Function, member.namePosition, member.position, uri));
	}

	for (const item of member.inputs) {
		if (item.name) {
			const { symbol, defRange } = collectFromPatternItem(item, uri);
			symbols.push(symbol);
			defRanges.push(defRange);
		}
	}

	for (const item of member.outputs) {
		if (item.name) {
			const { symbol, defRange } = collectFromPatternItem(item, uri);
			symbols.push(symbol);
			defRanges.push(defRange);
		}
	}

	for (const stmt of member.body) {
		const { symbols: stmtSyms, defRanges: stmtDefs } = collectFromStatement(stmt, uri);
		symbols.push(...stmtSyms);
		defRanges.push(...stmtDefs);
	}

	return { symbols, defRanges };
}

export function collectDefinitionsFromMember(member: Member, uri: vscode.Uri): vscode.SymbolInformation[] {
	return collectFromMember(member, uri).symbols;
}

export function collectDefRangesFromMember(member: Member, uri: vscode.Uri): SymbolDefinition[] {
	return collectFromMember(member, uri).defRanges;
}

/* ------------------------------------------------------------------ */
/*  Parse                                                              */
/* ------------------------------------------------------------------ */

export function parseZingDocument(text: string, uri: vscode.Uri): ZingDocument {
	if (text == undefined) {
		return new ZingDocument(uri, { includes: [], parameters: [], members: [], parseErrors: [] });
	}

	const tokens = new Tokenizer(text).tokenize();
	const ast = parseTokens(tokens);

	const doc = new ZingDocument(uri, ast);
	doc.symbols = ast.members.filter(m => m.name).map(m => toSymbol(m.name, vscode.SymbolKind.Function, m.namePosition, uri));
	doc.definitions = [];
	doc.definitionRanges = [];

	for (const param of ast.parameters) {
		const { symbol, defRange } = collectFromParameter(param, uri);
		doc.definitions.push(symbol);
		doc.definitionRanges.push(defRange);
	}

	for (const member of ast.members) {
		const { symbols, defRanges } = collectFromMember(member, uri);
		doc.definitions.push(...symbols);
		doc.definitionRanges.push(...defRanges);
	}

	doc.includes = ast.includes.map(i => i.path);

	return doc;
}

export function documentSymbols(document: vscode.TextDocument): vscode.SymbolInformation[] {
	if (document != undefined) {
		return parseZingDocument(document.getText(), document.uri).symbols;
	}
	return [];
}

export let documentSymbolProvider: vscode.DocumentSymbolProvider = {
	provideDocumentSymbols(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
		return documentSymbols(document);
	}
}
