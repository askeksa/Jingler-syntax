import * as vscode from 'vscode';
import {
	collectDefRangesFromMember,
	isSymbolStartCharacter,
	isSymbolMiddleCharacter,
	parseZingDocument,
	SymbolDefinition,
	ZingDocument
} from "./document_symbols";
import { Member, Parameter } from "./ast";

/* ------------------------------------------------------------------ */
/*  Shared symbol lookup (used by both definitions and hover)          */
/* ------------------------------------------------------------------ */

export function alphaNumericLabelLength(line: string, index: number): number {
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

export function symbolAt(line: string, position: number): string | undefined {
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

export function findEnclosingMember(ast: { members: Member[] }, cursorLine: number): Member | undefined {
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

export async function findSymbolInDocument(document: ZingDocument, symbol: string, cursorLine: number): Promise<SymbolDefinition | undefined> {
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

	const visited = new Set<string>();
	for (let includePath of document.includes) {
		let includeUri = vscode.Uri.joinPath(document.uri, "..", includePath);
		try {
			let bytes = await vscode.workspace.fs.readFile(includeUri);
			let text = new TextDecoder().decode(bytes);
			const incDoc = parseZingDocument(text, includeUri);
			const found = await findSymbolInDocument(incDoc, symbol, cursorLine);
			if (found != undefined)
				return found;
			if (visited.has(includeUri.toString())) continue;
			visited.add(includeUri.toString());
			const nestedFound = await findSymbolInIncludesRecursive(incDoc.includes, includeUri, symbol, cursorLine, visited);
			if (nestedFound != undefined)
				return nestedFound;
		} catch (e) {
			// Ignore errors reading the file
		}
	}

	return undefined;
}

async function findSymbolInIncludesRecursive(
	includePaths: string[],
	baseUri: vscode.Uri,
	symbol: string,
	cursorLine: number,
	visited: Set<string>
): Promise<SymbolDefinition | undefined> {
	for (const includePath of includePaths) {
		const includeUri = vscode.Uri.joinPath(baseUri, "..", includePath);
		try {
			const bytes = await vscode.workspace.fs.readFile(includeUri);
			const text = new TextDecoder().decode(bytes);
			const incDoc = parseZingDocument(text, includeUri);
			const found = await findSymbolInDocument(incDoc, symbol, cursorLine);
			if (found != undefined)
				return found;
			if (visited.has(includeUri.toString())) continue;
			visited.add(includeUri.toString());
			const nestedFound = await findSymbolInIncludesRecursive(incDoc.includes, includeUri, symbol, cursorLine, visited);
			if (nestedFound != undefined)
				return nestedFound;
		} catch {
			// Ignore errors reading the file
		}
	}
	return undefined;
}

export interface LookupResult {
	member?: Member;
	parameter?: Parameter;
}

export async function findSymbolInIncludes(
	includes: string[],
	baseUri: vscode.Uri,
	symbol: string
): Promise<LookupResult | undefined> {
	const visited = new Set<string>();
	return findMemberOrParamInIncludesRecursive(includes, baseUri, symbol, visited);
}

async function findMemberOrParamInIncludesRecursive(
	includePaths: string[],
	baseUri: vscode.Uri,
	symbol: string,
	visited: Set<string>
): Promise<LookupResult | undefined> {
	for (const includePath of includePaths) {
		const includeUri = vscode.Uri.joinPath(baseUri, "..", includePath);
		if (visited.has(includeUri.toString())) continue;
		visited.add(includeUri.toString());
		try {
			const bytes = await vscode.workspace.fs.readFile(includeUri);
			const text = new TextDecoder().decode(bytes);
			const incDoc = parseZingDocument(text, includeUri);

			// Check members
			for (const member of incDoc.ast.members) {
				if (member.name === symbol) {
					return { member };
				}
			}

			// Check parameters
			for (const param of incDoc.ast.parameters) {
				if (param.name === symbol) {
					return { parameter: param };
				}
			}

			// Recurse into nested includes
			const nestedFound = await findMemberOrParamInIncludesRecursive(incDoc.includes, includeUri, symbol, visited);
			if (nestedFound != undefined)
				return nestedFound;
		} catch {
			// Ignore errors reading the file
		}
	}
	return undefined;
}

/* ------------------------------------------------------------------ */
/*  Definition provider                                                */
/* ------------------------------------------------------------------ */

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
};
