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
	| "Question" | "Colon" | "ColonColon" | "Arrow" | "Dot" | "Not";

type DelimiterKind =
	| "LParen" | "RParen"
	| "LSquare" | "RSquare"
	| "LBrace" | "RBrace"
	| "Comma";

type LiteralKind =
	| "Integer" | "Decimal" | "Hex"
	| "String" | "True" | "False"
	| "Identifier";

type MetaKind = "Eof";

type MidiKind = "MidiMapping";

export type TokenKind =
	| KeywordKind
	| OperatorKind
	| DelimiterKind
	| LiteralKind
	| MetaKind
	| MidiKind;

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

function isIdentStart(ch: string): boolean {
	return (ch >= "a" && ch <= "z")
		|| (ch >= "A" && ch <= "Z")
		|| ch === "_";
}

function isIdentCont(ch: string): boolean {
	return isIdentStart(ch) || (ch >= "0" && ch <= "9");
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

export class Tokenizer {
	private readonly source: string;
	private pos: number = 0;
	private line: number = 0;
	private character: number = 0;

	constructor(source: string) {
		this.source = source;
	}

	public tokenize(): Token[] {
		const tokens: Token[] = [];
		while (this.pos < this.source.length) {
			const ch = this.source[this.pos];

			if (ch === "\n") {
				this.pos++;
				this.line++;
				this.character = 0;
				continue;
			}

			if (ch === " " || ch === "\t" || ch === "\r") {
				this.pos++;
				this.character++;
				continue;
			}

			if (ch === "#" && this.isHashComment()) {
				while (this.pos < this.source.length && this.source[this.pos] !== "\n") {
					this.pos++;
					this.character++;
				}
				continue;
			}

			const startPos = this.pos;
			const startLine = this.line;
			const startChar = this.character;

			if (ch === '"') {
				this.readString();
				tokens.push({ kind: "String", text: this.source.substring(startPos, this.pos), line: startLine, character: startChar });
			} else if (isIdentStart(ch)) {
				const midi = this.tryMidiMappingIdentifier(startPos, startLine, startChar);
				if (midi !== null) {
					tokens.push(midi);
				} else {
					this.readIdent();
					const text = this.source.substring(startPos, this.pos);
					tokens.push({ kind: this.classifyIdent(text), text, line: startLine, character: startChar });
				}
			} else if (ch >= "0" && ch <= "9") {
				const midi = this.tryMidiMappingNumber(startPos, startLine, startChar);
				if (midi !== null) {
					tokens.push(midi);
				} else {
					this.readNumber();
					const text = this.source.substring(startPos, this.pos);
					tokens.push({ kind: this.classifyNumber(text), text, line: startLine, character: startChar });
				}
			} else {
				this.readPunctuator(startPos, startLine, startChar);
				tokens.push(this.lastToken);
			}
		}
		tokens.push({ kind: "Eof", text: "", line: this.line, character: this.character });
		return tokens;
	}

	private lastToken: Token = { kind: "Eof", text: "", line: 0, character: 0 };

	private isHashComment(): boolean {
		let lineStart = this.pos - 1;
		while (lineStart >= 0 && this.source[lineStart] !== "\n") {
			lineStart--;
		}
		lineStart++;
		return isHashComment(this.source, lineStart, this.pos);
	}

	private readString(): void {
		this.pos++;
		this.character++;
		while (this.pos < this.source.length && this.source[this.pos] !== '"') {
			this.pos++;
			this.character++;
		}
		if (this.pos < this.source.length) {
			this.pos++;
			this.character++;
		}
	}

	private readIdent(): void {
		this.pos++;
		this.character++;
		while (this.pos < this.source.length && isIdentCont(this.source[this.pos])) {
			this.pos++;
			this.character++;
		}
	}

	private classifyIdent(text: string): TokenKind {
		if (text === "true") return "True";
		if (text === "false") return "False";
		const kw = KEYWORD_MAP.get(text);
		if (kw !== undefined) return kw;
		return "Identifier";
	}

	private readNumber(): void {
		if (this.source[this.pos] === "0"
			&& this.pos + 1 < this.source.length
			&& (this.source[this.pos + 1] === "x" || this.source[this.pos + 1] === "X")) {
			this.pos += 2;
			this.character += 2;
			while (this.pos < this.source.length
				&& ((this.source[this.pos] >= "0" && this.source[this.pos] <= "9")
					|| (this.source[this.pos] >= "a" && this.source[this.pos] <= "f")
					|| (this.source[this.pos] >= "A" && this.source[this.pos] <= "F")
					|| this.source[this.pos] === ".")) {
				this.pos++;
				this.character++;
			}
			return;
		}
		while (this.pos < this.source.length && this.source[this.pos] >= "0" && this.source[this.pos] <= "9") {
			this.pos++;
			this.character++;
		}
		if (this.pos < this.source.length && this.source[this.pos] === ".") {
			const beforePos = this.pos;
			const beforeChar = this.character;
			this.pos++;
			this.character++;
			while (this.pos < this.source.length && this.source[this.pos] >= "0" && this.source[this.pos] <= "9") {
				this.pos++;
				this.character++;
			}
			if (this.pos === beforePos + 1) {
				this.pos = beforePos;
				this.character = beforeChar;
			}
		}
	}

	private classifyNumber(text: string): TokenKind {
		if (text.startsWith("0x") || text.startsWith("0X")) return "Hex";
		return "Decimal";
	}

	private readPunctuator(startPos: number, startLine: number, startChar: number): void {
		const ch = this.source[this.pos];

		if (ch === "-" && this.pos + 1 < this.source.length && this.source[this.pos + 1] === "+") {
			this.pos += 2;
			this.character += 2;
			this.lastToken = { kind: "MinusPlus", text: "-+", line: startLine, character: startChar };
			return;
		}
		if (ch === "-" && this.pos + 1 < this.source.length && this.source[this.pos + 1] === ">") {
			this.pos += 2;
			this.character += 2;
			this.lastToken = { kind: "Arrow", text: "->", line: startLine, character: startChar };
			return;
		}

		const twoChar = this.source.substring(this.pos, this.pos + 2);
		const kind2 = this.twoCharKind(twoChar);
		if (kind2 !== null) {
			this.pos += 2;
			this.character += 2;
			this.lastToken = { kind: kind2, text: twoChar, line: startLine, character: startChar };
			return;
		}

		const kind1 = this.oneCharKind(ch);
		if (kind1 !== null) {
			this.pos++;
			this.character++;
			this.lastToken = { kind: kind1, text: ch, line: startLine, character: startChar };
			return;
		}

		this.pos++;
		this.character++;
		this.lastToken = { kind: "Identifier", text: ch, line: startLine, character: startChar };
	}

	private twoCharKind(s: string): TokenKind | null {
		switch (s) {
			case "==": return "Eq";
			case "!=": return "Neq";
			case "<=": return "LessEq";
			case ">=": return "GreaterEq";
			case "::": return "ColonColon";
			default: return null;
		}
	}

	private oneCharKind(ch: string): TokenKind | null {
		switch (ch) {
			case "+": return "Plus";
			case "-": return "Minus";
			case "*": return "Multiply";
			case "/": return "Divide";
			case "=": return "Assign";
			case "<": return "Less";
			case ">": return "Greater";
			case "|": return "Or";
			case "^": return "Xor";
			case "&": return "And";
			case "?": return "Question";
			case ":": return "Colon";
			case ".": return "Dot";
			case "!": return "Not";
			case "(": return "LParen";
			case ")": return "RParen";
			case "[": return "LSquare";
			case "]": return "RSquare";
			case "{": return "LBrace";
			case "}": return "RBrace";
			case ",": return "Comma";
			default: return null;
		}
	}

	private tryMidiMappingNumber(startPos: number, startLine: number, startChar: number): Token | null {
		const startCol = this.character;
		while (this.pos < this.source.length && this.source[this.pos] >= "0" && this.source[this.pos] <= "9") {
			this.pos++;
			this.character++;
		}

		if (this.pos + 1 < this.source.length && this.source[this.pos] === ":" && this.source[this.pos + 1] === ":") {
			this.pos += 2;
			this.character += 2;
			return { kind: "MidiMapping", text: this.source.substring(startPos, this.pos), line: startLine, character: startChar };
		}

		if (this.pos < this.source.length && this.source[this.pos] === "{") {
			const result = this.tryMidiMappingRange(startPos, startLine, startChar);
			if (result !== null) return result;
		}

		this.pos = startPos;
		this.character = startCol;
		return null;
	}

	private tryMidiMappingRange(startPos: number, startLine: number, startChar: number): Token | null {
		const startCol = this.character;
		this.pos++;
		this.character++;

		const skipWs = (): void => {
			while (this.pos < this.source.length && (this.source[this.pos] === " " || this.source[this.pos] === "\t")) {
				this.pos++;
				this.character++;
			}
		};

		const parseNote = (): boolean => {
			skipWs();
			if (this.pos >= this.source.length || this.source[this.pos] < "A" || this.source[this.pos] > "G") {
				return false;
			}
			this.pos++;
			this.character++;
			if (this.pos < this.source.length && this.source[this.pos] === "#") {
				this.pos++;
				this.character++;
			}
			if (this.pos >= this.source.length || this.source[this.pos] < "0" || this.source[this.pos] > "9") {
				return false;
			}
			this.pos++;
			this.character++;
			return true;
		};

		if (!parseNote()) {
			this.pos = startPos;
			this.character = startCol;
			return null;
		}

		skipWs();
		if (this.pos + 1 < this.source.length && this.source[this.pos] === "." && this.source[this.pos + 1] === ".") {
			this.pos += 2;
			this.character += 2;
			skipWs();
			if (this.pos < this.source.length && this.source[this.pos] !== "}") {
				parseNote();
			}
		}

		skipWs();
		if (this.pos < this.source.length && this.source[this.pos] === "/") {
			this.pos++;
			this.character++;
			parseNote();
		}

		skipWs();
		if (this.pos >= this.source.length || this.source[this.pos] !== "}") {
			this.pos = startPos;
			this.character = startCol;
			return null;
		}
		this.pos++;
		this.character++;

		skipWs();
		if (this.pos + 1 >= this.source.length || this.source[this.pos] !== ":" || this.source[this.pos + 1] !== ":") {
			this.pos = startPos;
			this.character = startCol;
			return null;
		}
		this.pos += 2;
		this.character += 2;

		return { kind: "MidiMapping", text: this.source.substring(startPos, this.pos), line: startLine, character: startChar };
	}

	private tryMidiMappingIdentifier(startPos: number, startLine: number, startChar: number): Token | null {
		const startCol = this.character;
		this.pos++;
		this.character++;
		while (this.pos < this.source.length && isIdentCont(this.source[this.pos])) {
			this.pos++;
			this.character++;
		}

		if (this.pos + 1 < this.source.length && this.source[this.pos] === ":" && this.source[this.pos + 1] === ":") {
			const nextAfterColon = this.pos + 2;
			if (nextAfterColon >= this.source.length || !isIdentStart(this.source[nextAfterColon])) {
				this.pos += 2;
				this.character += 2;
				return { kind: "MidiMapping", text: this.source.substring(startPos, this.pos), line: startLine, character: startChar };
			}
		}

		this.pos = startPos;
		this.character = startCol;
		return null;
	}
}
