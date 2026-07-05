// Minimal mock of vscode for running tests outside the extension host.

export const DiagnosticSeverity = {
	Error: 0,
	Warning: 1,
	Information: 2,
	Hint: 3,
};

export class Position {
	line: number;
	character: number;
	constructor(line: number, character: number) {
		this.line = line;
		this.character = character;
	}
}

export class Range {
	start: Position;
	end: Position;
	constructor(start: Position, end: Position) {
		this.start = start;
		this.end = end;
	}
}

export class DiagnosticRelatedInformation {
	location: { uri: Uri; range: Range };
	message: string;
	constructor(location: { uri: Uri; range: Range }, message: string) {
		this.location = location;
		this.message = message;
	}
}

export class Diagnostic {
	severity: number;
	message: string;
	range: Range;
	relatedInformation?: DiagnosticRelatedInformation[];
	constructor(range: Range, message: string, severity?: number) {
		this.range = range;
		this.message = message;
		this.severity = severity ?? DiagnosticSeverity.Error;
	}
}

export class Location {
	uri: Uri;
	range: Range;
	constructor(uri: Uri, range: Range) {
		this.uri = uri;
		this.range = range;
	}
}

export class SymbolInformation {
	name: string;
	kind: number;
	containerName: string;
	location: Location;
	constructor(name: string, kind: number, containerName: string, location: Location) {
		this.name = name;
		this.kind = kind;
		this.containerName = containerName;
		this.location = location;
	}
}

export class Uri {
	scheme: string;
	path: string;
	constructor(scheme: string, path: string) {
		this.scheme = scheme;
		this.path = path;
	}
}

export class CancellationToken {
	isCancellationRequested: boolean = false;
	onCancellationRequested: { dispose: () => void } = { dispose: () => {} };
}

export class CancellationTokenSource {
	token: CancellationToken = new CancellationToken();
	cancel(): void { this.token.isCancellationRequested = true; }
	dispose(): void {}
}

export class MarkdownString {
	value: string;
	supportHtml: boolean = false;
	constructor(value?: string) {
		this.value = value ?? "";
	}
}

export class DocumentSymbol {
	name: string = "";
	detail: string = "";
	kind: number = 0;
	range: Range = new Range(new Position(0, 0), new Position(0, 0));
	selectionRange: Range = new Range(new Position(0, 0), new Position(0, 0));
	children: DocumentSymbol[] = [];
}

export const SymbolKind = {
	File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5,
	Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10,
	Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15,
	Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
	Struct: 22, Event: 23, Operator: 24, TypeParameter: 25,
};

export class Hover {
	contents: (MarkdownString | string)[];
	range?: Range;
	constructor(contents: MarkdownString | string | (MarkdownString | string)[], range?: Range) {
		this.contents = Array.isArray(contents) ? contents : [contents];
		this.range = range;
	}
}

export class TextDocument {
	uri: Uri;
	languageId: string;
	private _text: string;
	private _lines: string[];

	constructor(uri: Uri, languageId: string, text: string) {
		this.uri = uri;
		this.languageId = languageId;
		this._text = text;
		this._lines = text.split("\n");
	}

	getText(): string {
		return this._text;
	}

	lineAt(line: number): { text: string; range: Range; firstCharacter: number; rangeIncludingLineBreak: Range; firstNonWhitespaceCharacterIndex: number } {
		const text = this._lines[line] ?? "";
		const start = new Position(line, 0);
		return {
			text,
			range: new Range(start, new Position(line, text.length)),
			firstCharacter: 0,
			rangeIncludingLineBreak: new Range(start, new Position(line, text.length)),
			firstNonWhitespaceCharacterIndex: text.search(/\S/),
		};
	}

	get lineCount(): number {
		return this._lines.length;
	}
}

export class OutputChannel {
	name: string;
	private _lines: string[] = [];
	constructor(name: string) {
		this.name = name;
	}
	appendLine(line: string): void {
		this._lines.push(line);
	}
	append(_text: string): void {}
	dispose(): void {}
	clear(): void {}
	show(): void {}
	hide(): void {}
}

export namespace window {
	export function createOutputChannel(name: string): OutputChannel {
		return new OutputChannel(name);
	}
}

export namespace workspace {
	export async function openTextDocument(arg: { language: string; content: string } | Uri): Promise<TextDocument> {
		if (typeof (arg as any).language === "string") {
			const opts = arg as { language: string; content: string };
			return new TextDocument(Uri.file("/tmp/virtual.zing"), opts.language, opts.content);
		} else {
			const uri = arg as Uri;
			const fs = require("fs");
			const text = fs.readFileSync(uri.path, "utf-8");
			return new TextDocument(uri, "zing", text);
		}
	}

	export const fs = {
		async readFile(uri: Uri): Promise<Uint8Array> {
			const fs = require("fs");
			return fs.readFileSync(uri.path);
		},
	};
}

export namespace Uri {
	export function file(path: string): Uri {
		return new Uri("file", path);
	}

	export function joinPath(base: Uri, ...parts: string[]): Uri {
		let result = base.path;
		for (const part of parts) {
			if (part === "..") {
				const idx = result.lastIndexOf("/");
				result = idx >= 0 ? result.substring(0, idx) : result;
			} else {
				result = result + "/" + part;
			}
		}
		return new Uri(base.scheme, result);
	}
}

export type ProviderResult<T> = T | undefined | Thenable<T>;

export class SemanticTokens {
	data: Uint32Array;
	constructor(data: Uint32Array) {
		this.data = data;
	}
}

export class SemanticTokensLegend {
	tokenTypes: string[];
	tokenModifiers: string[];
	constructor(tokenTypes: string[], tokenModifiers: string[]) {
		this.tokenTypes = tokenTypes;
		this.tokenModifiers = tokenModifiers;
	}
}

export interface DocumentSemanticTokensProvider {
	provideDocumentSemanticTokens(document: TextDocument, token: CancellationToken): ProviderResult<SemanticTokens>;
	releaseDocumentSemanticTokens(tokens: SemanticTokens): void;
}

export interface DocumentSymbolProvider {
	provideDocumentSymbols(document: TextDocument, token: CancellationToken): ProviderResult<DocumentSymbol[]>;
}

export interface HoverProvider {
	provideHover(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Hover>;
}
