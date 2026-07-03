import * as vscode from 'vscode';
import { Tokenizer } from "./tokenizer";
import { parseTokens } from "./parser";
import { Program, Member, Parameter, Statement } from "./ast";

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

function toSymbol(name: string, kind: vscode.SymbolKind, position: { line: number; character: number; endLine?: number; endCharacter?: number }, uri: vscode.Uri): vscode.SymbolInformation {
	const pos = new vscode.Position(position.line, position.character);
	const endPos = position.endLine != undefined
		? new vscode.Position(position.endLine, position.endCharacter!)
		: new vscode.Position(position.line, position.character + name.length);
	return new vscode.SymbolInformation(
		name,
		kind,
		"",
		new vscode.Location(uri, new vscode.Range(pos, endPos))
	);
}

function toSymbolDef(name: string, kind: vscode.SymbolKind, namePosition: { line: number; character: number; endLine?: number; endCharacter?: number }, fullPosition: { line: number; character: number; endLine?: number; endCharacter?: number }, uri: vscode.Uri): SymbolDefinition {
	const namePos = new vscode.Position(namePosition.line, namePosition.character);
	const nameEndPos = namePosition.endLine != undefined
		? new vscode.Position(namePosition.endLine, namePosition.endCharacter!)
		: new vscode.Position(namePosition.line, namePosition.character + name.length);
	const fullPos = new vscode.Position(fullPosition.line, fullPosition.character);
	const fullEndPos = fullPosition.endLine != undefined
		? new vscode.Position(fullPosition.endLine, fullPosition.endCharacter!)
		: new vscode.Position(fullPosition.line, fullPosition.character + name.length);
	return {
		name,
		nameRange: new vscode.Range(namePos, nameEndPos),
		fullRange: new vscode.Range(fullPos, fullEndPos),
		uri,
	};
}

export function collectDefinitionsFromMember(member: Member, uri: vscode.Uri): vscode.SymbolInformation[] {
	const defs: vscode.SymbolInformation[] = [];

	// Member name
	if (member.name) {
		defs.push(toSymbol(member.name, vscode.SymbolKind.Function, member.namePosition, uri));
	}

	// Inputs
	for (const item of member.inputs) {
		if (item.name) {
			defs.push(toSymbol(item.name, vscode.SymbolKind.Variable, item.position, uri));
		}
	}

	// Outputs
	for (const item of member.outputs) {
		if (item.name) {
			defs.push(toSymbol(item.name, vscode.SymbolKind.Variable, item.position, uri));
		}
	}

	// Assignment statement patterns (local variables)
	for (const stmt of member.body) {
		collectDefinitionsFromStatement(stmt, uri, defs);
	}

	return defs;
}

export function collectDefRangesFromMember(member: Member, uri: vscode.Uri): SymbolDefinition[] {
	const defs: SymbolDefinition[] = [];

	// Member name
	if (member.name) {
		defs.push(toSymbolDef(member.name, vscode.SymbolKind.Function, member.namePosition, member.position, uri));
	}

	// Inputs
	for (const item of member.inputs) {
		if (item.name) {
			defs.push(toSymbolDef(item.name, vscode.SymbolKind.Variable, item.position, item.position, uri));
		}
	}

	// Outputs
	for (const item of member.outputs) {
		if (item.name) {
			defs.push(toSymbolDef(item.name, vscode.SymbolKind.Variable, item.position, item.position, uri));
		}
	}

	// Assignment statement patterns (local variables)
	for (const stmt of member.body) {
		collectDefRangesFromStatement(stmt, uri, defs);
	}

	return defs;
}

function collectDefinitionsFromStatement(stmt: Statement, uri: vscode.Uri, defs: vscode.SymbolInformation[]): void {
	for (const item of stmt.pattern) {
		if (item.name) {
			defs.push(toSymbol(item.name, vscode.SymbolKind.Variable, item.position, uri));
		}
	}
}

function collectDefRangesFromStatement(stmt: Statement, uri: vscode.Uri, defs: SymbolDefinition[]): void {
	for (const item of stmt.pattern) {
		if (item.name) {
			defs.push(toSymbolDef(item.name, vscode.SymbolKind.Variable, item.position, stmt.position, uri));
		}
	}
}

function collectDefinitionsFromParameter(param: Parameter, uri: vscode.Uri): vscode.SymbolInformation[] {
	const defs: vscode.SymbolInformation[] = [];
	if (param.name) {
		defs.push(toSymbol(param.name, vscode.SymbolKind.Constant, param.namePosition, uri));
	}
	return defs;
}

function collectDefRangesFromParameter(param: Parameter, uri: vscode.Uri): SymbolDefinition[] {
	const defs: SymbolDefinition[] = [];
	if (param.name) {
		defs.push(toSymbolDef(param.name, vscode.SymbolKind.Constant, param.namePosition, param.position, uri));
	}
	return defs;
}

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

	// Top-level parameters
	for (const param of ast.parameters) {
		doc.definitions.push(...collectDefinitionsFromParameter(param, uri));
		doc.definitionRanges.push(...collectDefRangesFromParameter(param, uri));
	}

	// Members (name + inputs + outputs + body assignments)
	for (const member of ast.members) {
		doc.definitions.push(...collectDefinitionsFromMember(member, uri));
		doc.definitionRanges.push(...collectDefRangesFromMember(member, uri));
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