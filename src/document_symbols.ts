import * as vscode from 'vscode';
import { Tokenizer } from "./tokenizer";
import { parseTokens } from "./parser";
import { Program, Member } from "./ast";

export class ZingDocument {
	symbols: vscode.SymbolInformation[];
	includes: string[];
	uri: vscode.Uri;
	ast: Program;

	constructor(uri: vscode.Uri, ast: Program) {
		this.uri = uri;
		this.ast = ast;
		this.symbols = [];
		this.includes = [];
	}
}

export function isSymbolStartCharacter(ch: string) {
	return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch == "_";
}

export function isSymbolMiddleCharacter(ch: string) {
	return isSymbolStartCharacter(ch) || (ch >= "0" && ch <= "9");
}

function memberToSymbol(member: Member, uri: vscode.Uri): vscode.SymbolInformation {
	const pos = new vscode.Position(member.namePosition.line, member.namePosition.character);
	const endPos = new vscode.Position(member.namePosition.line, member.namePosition.character + member.name.length);
	return new vscode.SymbolInformation(
		member.name,
		vscode.SymbolKind.Function,
		"",
		new vscode.Location(uri, new vscode.Range(pos, endPos))
	);
}

export function parseZingDocument(text: string, uri: vscode.Uri): ZingDocument {
	if (text == undefined) {
		return new ZingDocument(uri, { includes: [], parameters: [], members: [], parseErrors: [] });
	}

	const tokens = new Tokenizer(text).tokenize();
	const ast = parseTokens(tokens);

	const doc = new ZingDocument(uri, ast);
	doc.symbols = ast.members.filter(m => m.name).map(m => memberToSymbol(m, uri));
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