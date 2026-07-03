import * as vscode from 'vscode';
import { collectDefRangesFromMember, isSymbolStartCharacter, isSymbolMiddleCharacter, parseZingDocument, SymbolDefinition, ZingDocument } from "./document_symbols";
import { Member } from "./ast";

function alphaNumericLabelLength(line: string, index: number): number {
	if (index >= line.length)
		return 0;

	let startIndex = index;
	if (isSymbolStartCharacter(line[startIndex])) {
		let endIndex = startIndex + 1;

		while (index < line.length && isSymbolMiddleCharacter(line[endIndex])) {
			endIndex += 1;
		}

		return endIndex - startIndex;
	}

	return 0;
}

function symbolAt(line: string, position: number): string | undefined {
	let cursor = position;
	let bestPosition = -1;
	let longest = -1;

	while (position >= 0) {
		let length = alphaNumericLabelLength(line, position);
		if (length > 0 && position + length >= cursor && length > longest) {
			bestPosition = position;
			longest = length;
		}
		position -= 1;
	}

	if (bestPosition < 0)
		return undefined;

	return line.slice(bestPosition, bestPosition + longest);
}


function findEnclosingMember(ast: { members: Member[] }, cursorLine: number): Member | undefined {
	let last: Member | undefined = undefined;
	for (const member of ast.members) {
		if (member.position.line <= cursorLine) {
			last = member;
		}
	}
	return last;
}

function findSymbol(definitions: SymbolDefinition[], symbol: string): SymbolDefinition | undefined {
	for (let definition of definitions) {
		if (definition.name == symbol) {
			return definition;
		}
	}

	return undefined;
}


async function findSymbolInDocument(document: ZingDocument, symbol: string, cursorLine: number): Promise<SymbolDefinition | undefined> {
	const enclosing = findEnclosingMember(document.ast, cursorLine);
	if (enclosing != undefined) {
		const localDefs = collectDefRangesFromMember(enclosing, document.uri);
		const result = findSymbol(localDefs, symbol);
		if (result != undefined)
			return result;
	}

	const result = findSymbol(document.definitionRanges, symbol);
	if (result != undefined)
		return result;

	for (let includePath of document.includes) {
		let includeUri = vscode.Uri.joinPath(document.uri, "..", includePath);
		try {
			let bytes = await vscode.workspace.fs.readFile(includeUri);
			let text = new TextDecoder().decode(bytes);

			const found = await findSymbolInDocument(parseZingDocument(text, includeUri), symbol, cursorLine);
			if (found != undefined)
				return found;
		} catch (e) {
			// Ignore errors reading the file
		}
	}
}


export let definitionProvider: vscode.DefinitionProvider = {
	async provideDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.Definition | vscode.DefinitionLink[] | null> {
		let line = document.lineAt(position.line).text;
		let symbol = symbolAt(line, position.character);

		if (symbol != undefined) {
			const sym = await findSymbolInDocument(parseZingDocument(document.getText(), document.uri), symbol, position.line);
			if (sym != undefined) {
				return [{
					targetUri: sym.uri,
					targetRange: sym.fullRange,
					targetSelectionRange: sym.nameRange,
				}];
			}
		}

		return null;
	}
}