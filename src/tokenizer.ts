export interface Lexeme {
	text: string;
	line: number;
	character: number;
}

type KeywordKind =
	| "Include" | "Parameter" | "To"
	| "Global" | "Note"
	| "Module" | "Function" | "Instrument"
	| "For" | "Buffer"
	| "Static" | "Dynamic"
	| "Mono" | "Stereo" | "Generic"
	| "NumberKw" | "BoolKw"
	| "Inf";

type OperatorKind =
	| "Plus" | "Minus" | "MinusPlus" | "Multiply" | "Divide"
	| "Assign" | "Eq" | "Neq"
	| "Less" | "LessEq" | "Greater" | "GreaterEq"
	| "Or" | "Xor" | "And"
	| "Question" | "Colon" | "ColonColon" | "Arrow" | "Dot" | "DotDot" | "Not";

type DelimiterKind =
	| "LParen" | "RParen"
	| "LSquare" | "RSquare"
	| "LBrace" | "RBrace"
	| "Comma";

type LiteralKind =
	| "Integer" | "Decimal" | "Hex"
	| "String" | "True" | "False"
	| "Identifier" | "Comment";

type MetaKind = "Eof";

export type TokenKind =
	| KeywordKind
	| OperatorKind
	| DelimiterKind
	| LiteralKind
	| MetaKind;

export interface Token {
	kind: TokenKind;
	text: string;
	line: number;
	character: number;
}

const KEYWORD_MAP: Map<string, KeywordKind> = new Map([
	["include", "Include"], ["parameter", "Parameter"], ["to", "To"],
	["global", "Global"], ["note", "Note"],
	["module", "Module"], ["function", "Function"], ["instrument", "Instrument"],
	["for", "For"], ["buffer", "Buffer"],
	["static", "Static"], ["dynamic", "Dynamic"],
	["mono", "Mono"], ["stereo", "Stereo"], ["generic", "Generic"],
	["number", "NumberKw"], ["bool", "BoolKw"],
	["inf", "Inf"],
]);

const OP_MAP: Map<string, OperatorKind> = new Map([
	["-+", "MinusPlus"],
	["->", "Arrow"],
	["==", "Eq"],
	["!=", "Neq"],
	["<=", "LessEq"],
	[">=", "GreaterEq"],
	["::", "ColonColon"],
	["..", "DotDot"],
	["+", "Plus"],
	["-", "Minus"],
	["*", "Multiply"],
	["/", "Divide"],
	["=", "Assign"],
	["<", "Less"],
	[">", "Greater"],
	["|", "Or"],
	["^", "Xor"],
	["&", "And"],
	["?", "Question"],
	[":", "Colon"],
	[".", "Dot"],
	["!", "Not"],
]);

const DELIM_MAP: Map<string, DelimiterKind> = new Map([
	["(", "LParen"], [")", "RParen"],
	["[", "LSquare"], ["]", "RSquare"],
	["{", "LBrace"], ["}", "RBrace"],
	[",", "Comma"],
]);

function isIdentStart(ch: string): boolean {
	return (ch >= "a" && ch <= "z")
		|| (ch >= "A" && ch <= "Z")
		|| ch === "_";
}

function isIdentCont(ch: string): boolean {
	return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function isDigit(ch: string): boolean {
	return ch >= "0" && ch <= "9";
}

function isHexDigit(ch: string): boolean {
	return isDigit(ch)
		|| (ch >= "a" && ch <= "f")
		|| (ch >= "A" && ch <= "F");
}

function isWhitespace(ch: string): boolean {
	return ch === " " || ch === "\t" || ch === "\r";
}

enum CommentState { Initial, Note, Sharp }

function isHashComment(source: string, lineStart: number, hashPos: number): boolean {
	let state: CommentState = CommentState.Initial;
	for (let i = lineStart; i < hashPos; i++) {
		const ch = source[i];
		switch (state) {
			case CommentState.Initial:
				if (ch >= "A" && ch <= "G") state = CommentState.Note;
				break;
			case CommentState.Note:
				state = CommentState.Initial;
				break;
		}
	}
	if (state === CommentState.Note) {
		const next = source[hashPos + 1];
		if (next >= "0" && next <= "9") {
			return false;
		}
	}
	return true;
}

/* ------------------------------------------------------------------ */
/*  Phase 1 – split source into raw lexeme strings                     */
/* ------------------------------------------------------------------ */

export interface SplitResult {
	lexemes: Lexeme[];
	endLine: number;
	endCharacter: number;
}

export function splitLexemes(source: string): SplitResult {
	const lexemes: Lexeme[] = [];
	let pos = 0;
	let line = 0;
	let character = 0;

	while (pos < source.length) {
		const ch = source[pos];

		// Newline
		if (ch === "\n") {
			pos++;
			line++;
			character = 0;
			continue;
		}

		// Whitespace
		if (isWhitespace(ch)) {
			pos++;
			character++;
			continue;
		}

		// Comment / sharp
		if (ch === "#") {
			let lineStart = pos - 1;
			while (lineStart >= 0 && source[lineStart] !== "\n") {
				lineStart--;
			}
			lineStart++;
			if (isHashComment(source, lineStart, pos)) {
				const commentStart = pos;
				const commentChar = character;
				while (pos < source.length && source[pos] !== "\n") {
					pos++;
					character++;
				}
				lexemes.push({ text: source.substring(commentStart, pos), line, character: commentChar });
				continue;
			}
			// Sharp (not a comment) — emit as single lexeme
			lexemes.push({ text: "#", line, character });
			pos++;
			character++;
			continue;
		}

		const startLine = line;
		const startChar = character;

		// String
		if (ch === '"') {
			const startPos = pos;
			pos++;
			character++;
			while (pos < source.length && source[pos] !== '"') {
				pos++;
				character++;
			}
			if (pos < source.length) {
				pos++;
				character++;
			}
			lexemes.push({ text: source.substring(startPos, pos), line: startLine, character: startChar });
			continue;
		}

		// Identifier
		if (isIdentStart(ch)) {
			const startPos = pos;
			pos++;
			character++;
			while (pos < source.length && isIdentCont(source[pos])) {
				pos++;
				character++;
			}
			lexemes.push({ text: source.substring(startPos, pos), line: startLine, character: startChar });
			continue;
		}

		// Number
		if (isDigit(ch)) {
			const startPos = pos;
			// Hex
			if (ch === "0" && pos + 1 < source.length && (source[pos + 1] === "x" || source[pos + 1] === "X")) {
				pos += 2;
				character += 2;
				while (pos < source.length && isHexDigit(source[pos])) {
					pos++;
					character++;
				}
				// Optional fractional part: single . followed by hex digits
				if (pos < source.length && source[pos] === "." && pos + 1 < source.length && isHexDigit(source[pos + 1])) {
					pos++;
					character++;
					while (pos < source.length && isHexDigit(source[pos])) {
						pos++;
						character++;
					}
				}
				lexemes.push({ text: source.substring(startPos, pos), line: startLine, character: startChar });
				continue;
			}
			// Decimal / integer
			while (pos < source.length && isDigit(source[pos])) {
				pos++;
				character++;
			}
			if (pos < source.length && source[pos] === ".") {
				const beforePos = pos;
				const beforeChar = character;
				pos++;
				character++;
				while (pos < source.length && isDigit(source[pos])) {
					pos++;
					character++;
				}
				if (pos === beforePos + 1) {
					pos = beforePos;
					character = beforeChar;
				}
			}
			lexemes.push({ text: source.substring(startPos, pos), line: startLine, character: startChar });
			continue;
		}

		// Punctuator — greedy two-char then one-char
		const twoChar = source.substring(pos, pos + 2);
		const kind2 = OP_MAP.get(twoChar) || DELIM_MAP.get(twoChar);
		if (kind2 !== undefined) {
			pos += 2;
			character += 2;
			lexemes.push({ text: twoChar, line: startLine, character: startChar });
			continue;
		}

		const kind1 = OP_MAP.get(ch) || DELIM_MAP.get(ch);
		if (kind1 !== undefined) {
			pos++;
			character++;
			lexemes.push({ text: ch, line: startLine, character: startChar });
			continue;
		}

		// Unknown — emit single char
		lexemes.push({ text: ch, line: startLine, character: startChar });
		pos++;
		character++;
	}

	return { lexemes, endLine: line, endCharacter: character };
}

/* ------------------------------------------------------------------ */
/*  Phase 2 – classify lexeme text into TokenKind                      */
/* ------------------------------------------------------------------ */

function classifyLexeme(text: string): TokenKind {
	// Keyword / boolean
	if (text === "true") return "True";
	if (text === "false") return "False";
	const kw = KEYWORD_MAP.get(text);
	if (kw !== undefined) return kw;

	// Operator / delimiter
	const op = OP_MAP.get(text);
	if (op !== undefined) return op;
	const delim = DELIM_MAP.get(text);
	if (delim !== undefined) return delim;

	// Comment (multi-char #... — single # is a sharp in note names)
	if (text.startsWith('#') && text.length > 1) return "Comment";

	// String
	if (text.startsWith('"')) return "String";

	// Hex number
	if (text.startsWith("0x") || text.startsWith("0X")) return "Hex";

	// Decimal number (contains dot or all digits)
	if (text.includes(".")) return "Decimal";
	if (/^[0-9]+$/.test(text)) return "Decimal";

	// Identifier
	return "Identifier";
}

export function matchLexemes(result: SplitResult): Token[] {
	const tokens: Token[] = [];
	for (const lex of result.lexemes) {
		tokens.push({
			kind: classifyLexeme(lex.text),
			text: lex.text,
			line: lex.line,
			character: lex.character,
		});
	}
	tokens.push({ kind: "Eof", text: "", line: result.endLine, character: result.endCharacter });
	return tokens;
}

/* ------------------------------------------------------------------ */
/*  Tokenizer – thin orchestrator                                      */
/* ------------------------------------------------------------------ */

export class Tokenizer {
	private readonly source: string;

	constructor(source: string) {
		this.source = source;
	}

	public tokenize(): Token[] {
		const result = splitLexemes(this.source);
		return matchLexemes(result);
	}
}

/* ------------------------------------------------------------------ */
/*  Filter — remove Comment + Eof for parser consumption               */
/* ------------------------------------------------------------------ */

export function filterTokens(tokens: Token[]): Token[] {
	const filtered: Token[] = [];
	for (const t of tokens) {
		if (t.kind !== "Comment" && t.kind !== "Eof") {
			filtered.push(t);
		}
	}
	const last = tokens[tokens.length - 1];
	filtered.push({ kind: "Eof", text: "", line: last?.line ?? 0, character: last?.character ?? 0 });
	return filtered;
}
