import * as vscode from 'vscode';
import { Tokenizer } from "./tokenizer";

export class ZingDocument {
	symbols: vscode.SymbolInformation[];
	includes: string[];
	uri: vscode.Uri;

	constructor(uri: vscode.Uri) {
		this.symbols = [];
		this.includes = [];
		this.uri = uri;
	}
}

export function isSymbolStartCharacter(ch: string) {
	return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch == "_";
}

export function isSymbolMiddleCharacter(ch: string) {
	return isSymbolStartCharacter(ch) || (ch >= "0" && ch <= "9");
}

function isMemberKind(kind: string): boolean {
	return kind === "Module" || kind === "Function" || kind === "Instrument";
}

export function parseZingDocument(text: string, uri: vscode.Uri): ZingDocument {
	const doc = new ZingDocument(uri);

	if (text == undefined)
		return doc;

	const tokens = new Tokenizer(text).tokenize();

	for (let i = 0; i < tokens.length; ++i) {
		if (isMemberKind(tokens[i].kind)) {
			i += 1;
			while (i + 1 < tokens.length && tokens[i + 1].kind === "ColonColon") {
				i += 2;
			}
			if (i < tokens.length) {
				const id = tokens[i].text;
				const pos = new vscode.Position(tokens[i].line, tokens[i].character);
				doc.symbols.push(new vscode.SymbolInformation(
					id,
					vscode.SymbolKind.Function,
					"",
					new vscode.Location(uri, new vscode.Range(pos, new vscode.Position(tokens[i].line, tokens[i].character + tokens[i].text.length)))
				));
			}
		} else if (tokens[i].kind === "Include") {
			i += 1;
			if (i < tokens.length && tokens[i].kind === "String") {
				let includePath = tokens[i].text;
				if (includePath.startsWith('"') && includePath.endsWith('"')) {
					includePath = includePath.slice(1, -1);
				}
				doc.includes.push(includePath);
			}
		}
	}

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
