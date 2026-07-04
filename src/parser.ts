import { Token, TokenKind, filterTokens } from "./tokenizer";
import {
	Position, ContextKind, MemberKind, ScopeKind, WidthKind, ValueTypeKind,
	ExplicitType, PatternItem, MidiParam, MidiMapping, MidiNoteRange,
	Parameter, Member, Include, Program, ParseError,
	Statement,
	Expression, ForCombinator,
} from "./ast";

const VALID_COMBINATORS = new Set(["add", "max", "min", "mul"]);

class Parser {
	private tokens: Token[];
	private pos: number = 0;
	private errors: ParseError[] = [];

	constructor(tokens: Token[]) {
		this.tokens = filterTokens(tokens);
	}

	private error(message: string): void {
		const tok = this.peek();
		this.errors.push({ message, position: this.posFromToken(tok) });
	}

	private peek(): Token {
		return this.tokens[this.pos] || { kind: "Eof", text: "", line: 0, character: 0 };
	}

	private peekKind(): TokenKind {
		return this.peek().kind;
	}

	private peekText(): string {
		return this.peek().text;
	}

	private peekAhead(offset: number): TokenKind {
		return this.tokens[this.pos + offset]?.kind || "Eof";
	}

	private consume(expected?: TokenKind): Token {
		const t = this.peek();
		if (expected && t.kind !== expected) {
			// skip — parser is lenient
		}
		this.pos++;
		return t;
	}

	private expect(kind: TokenKind): Token | null {
		if (this.peekKind() === kind) {
			return this.consume();
		}
		this.error(`expected '${kind}', got '${this.peekKind()}'`);
		return null;
	}

	private atKinds(...kinds: TokenKind[]): boolean {
		return kinds.includes(this.peekKind());
	}

	private posFromToken(t: Token): Position {
		return { line: t.line, character: t.character };
	}

	private endPosition(): { endLine: number; endCharacter: number } {
		const t = this.pos > 0 ? this.tokens[this.pos - 1] : this.peek();
		return { endLine: t.line, endCharacter: t.character + t.text.length };
	}

	// --- Program ---

	public parse(): Program {
		const includes: Include[] = [];
		const parameters: Parameter[] = [];
		const members: Member[] = [];

		while (this.peekKind() === "Include") {
			includes.push(this.parseInclude());
		}

		while (this.peekKind() === "Parameter") {
			parameters.push(this.parseParameter());
		}

		while (this.isMemberStart()) {
			members.push(this.parseMember());
		}

		return { includes, parameters, members, parseErrors: this.errors };
	}

	private isMemberStart(): boolean {
		const k = this.peekKind();
		if (k === "Global" || k === "Note" || k === "Module" || k === "Function" || k === "Instrument") {
			return true;
		}
		if (this.isMidiParamStart()) {
			const saved = this.pos;
			while (this.isMidiParamStart()) {
				this.consumeMidiParam();
			}
			const next = this.peekKind();
			this.pos = saved;
			return next === "Module" || next === "Function" || next === "Instrument"
				|| next === "Global" || next === "Note" || next === "Identifier";
		}
		return false;
	}

	private skipToNextMemberStart(): void {
		const memberStarts = ["Global", "Note", "Module", "Function", "Instrument", "Eof"];
		while (!memberStarts.includes(this.peekKind())) {
			this.consume();
		}
	}

	// --- MIDI param helpers ---

	// Member declaration: only Id "::" (MidiParam in real grammar)
	private isMidiParamStart(): boolean {
		return this.peekKind() === "Identifier" && this.peekAhead(1) === "ColonColon";
	}

	// Call expression: Id "::" | Num "::" | Num {...} "::" (MidiArg in real grammar)
	private isMidiArgStart(): boolean {
		if (this.peekKind() === "Identifier" && this.peekAhead(1) === "ColonColon") return true;
		if (this.peekKind() === "Decimal" || this.peekKind() === "Hex") {
			if (this.peekAhead(1) === "ColonColon") return true;
			if (this.peekAhead(1) === "LBrace") {
				const saved = this.pos;
				this.pos += 2; // skip Num and LBrace
				let depth = 1;
				while (this.pos < this.tokens.length && depth > 0) {
					const tk = this.tokens[this.pos].kind;
					if (tk === "LBrace") depth++;
					else if (tk === "RBrace") depth--;
					this.pos++;
				}
				const isMidi = this.peekKind() === "ColonColon";
				this.pos = saved;
				return isMidi;
			}
		}
		return false;
	}

	// Member declaration: Id "::" → MidiParam
	private consumeMidiParam(): MidiParam {
		const startTok = this.peek();
		const position = this.posFromToken(startTok);
		const name = this.consume().text;
		this.expect("ColonColon");
		return { name, position };
	}

	// Call expression: Uint "::" | Uint {...} "::" | Id "::" → MidiMapping
	private consumeMidiArg(): MidiMapping {
		const startTok = this.peek();
		const position = this.posFromToken(startTok);
		const k = this.peekKind();

		if (k === "Identifier") {
			const name = this.consume().text;
			this.expect("ColonColon");
			return { kind: "Named", name, position };
		}

		if (k === "Decimal" || k === "Hex") {
			const channelText = this.consume().text;
			const channel = parseInt(channelText, channelText.startsWith("0x") || channelText.startsWith("0X") ? 16 : 10);

			if (this.peekKind() === "LBrace") {
				this.consume(); // LBrace
				const { range, transposeTo } = this.parseMidiNoteRangeTranspose();
				this.expect("RBrace");
				this.expect("ColonColon");
				return { kind: "Value", channel, range, transposeTo, position };
			}

			this.expect("ColonColon");
			return {
				kind: "Value",
				channel,
				range: { start: 0, end: 127, position },
				transposeTo: 255,
				position,
			};
		}

		// Fallback
		this.consume();
		return { kind: "Named", name: "", position };
	}

	private parseMidiNoteRangeTranspose(): { range: MidiNoteRange; transposeTo: number } {
		const { start, end, position } = this.parseMidiNoteRange();
		let transposeTo = start;
		if (this.peekKind() === "Divide") {
			this.consume();
			transposeTo = this.parseMidiNote();
		}
		return { range: { start, end, position }, transposeTo };
	}

	// MidiNoteRange → MidiNote | ".." MidiNote | MidiNote ".." | MidiNote ".." MidiNote
	private parseMidiNoteRange(): { start: number; end: number; position: Position } {
		const pos = this.posFromToken(this.peek());

		if (this.peekKind() === "DotDot") {
			this.consume();
			const end = this.parseMidiNote();
			return { start: 255, end, position: pos };
		}

		const start = this.parseMidiNote();

		if (this.peekKind() === "DotDot") {
			this.consume();
			if (this.peekKind() === "RBrace") {
				return { start, end: 127, position: pos };
			}
			const end = this.parseMidiNote();
			return { start, end, position: pos };
		}

		return { start, end: start, position: pos };
	}

	// MidiNote → [A-G] [-#] [0-9] (e.g. C4, D#3, G#5)
	// Real Zing: notebase[C=0,D=2,E=4,F=5,G=7,A=9,B=11] + sharp + octave*12
	private parseMidiNote(): number {
		const tok = this.consume();
		const text = tok.text;

		// Single token like "C4" or "C#4"
		const match = text.match(/^([A-Ga-g])([-#]?)(\d+)$/);
		if (match) {
			const noteBase: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
			const base = noteBase[match[1].toUpperCase()];
			const sharp = match[2] === "#" ? 1 : 0;
			const octave = parseInt(match[3], 10);
			return base + sharp + octave * 12;
		}

		// Separate tokens: C # 4
		const noteBase: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
		const base = noteBase[text.toUpperCase()];
		const sharp = this.peekKind() === "Identifier" && this.peekText() === "#" ? this.consume() : null;
		const octave = this.consume().text;
		const octaveNum = parseInt(octave, 10);
		return base + (sharp ? 1 : 0) + octaveNum * 12;
	}

	// --- Include ---

	private parseInclude(): Include {
		const start = this.consume("Include");
		let path = "";
		let stringPosition: Position | undefined;
		const strTok = this.expect("String");
		if (strTok) {
			path = strTok.text;
			stringPosition = this.posFromToken(strTok);
			if (path.startsWith('"') && path.endsWith('"')) {
				path = path.slice(1, -1);
			}
		}
		return { path, position: this.posFromToken(start), stringPosition };
	}

	// --- Parameter ---

	private parseParameter(): Parameter {
		const start = this.consume("Parameter");
		const nameTok = this.consume();
		const minTok = this.parseSignedNum();
		this.expect("To");
		const maxTok = this.parseSignedNum();
		let defaultValue: string | undefined;
		if (this.peekKind() === "Assign") {
			this.consume();
			defaultValue = this.parseSignedNum();
		}
		return {
			name: nameTok.text,
			min: minTok,
			max: maxTok,
			defaultValue,
			position: { ...this.posFromToken(start), ...this.endPosition() },
			namePosition: this.posFromToken(nameTok),
		};
	}

	private parseSignedNum(): string {
		if (this.peekKind() === "Minus") {
			this.consume();
			const t = this.consume();
			return `-${t.text}`;
		}
		const t = this.consume();
		return t.text;
	}

	// --- Member ---

	private parseMember(): Member {
		const startTok = this.peek();
		const position = this.posFromToken(startTok);

		// Context
		let context: ContextKind = "Universal";
		let explicitContext = false;
		if (this.peekKind() === "Global") {
			this.consume();
			context = "Global";
			explicitContext = true;
		} else if (this.peekKind() === "Note") {
			this.consume();
			context = "Note";
			explicitContext = true;
		}

		// Kind
		let kind: MemberKind = "Module";
		if (this.peekKind() === "Module") {
			this.consume();
			kind = "Module";
		} else if (this.peekKind() === "Function") {
			this.consume();
			kind = "Function";
		} else if (this.peekKind() === "Instrument") {
			this.consume();
			kind = "Instrument";
		}

		// Apply default context if not explicitly set (matches real compiler)
		if (!explicitContext) {
			if (kind === "Module") {
				context = "Global";
			} else if (kind === "Instrument") {
				context = "Note";
			}
			// Function → Universal (already default)
		}

		// MIDI params
		const midiParams: MidiParam[] = [];
		while (this.isMidiParamStart()) {
			midiParams.push(this.consumeMidiParam());
		}

		// Name — single Id only (zing.lalrpop:33)
		let name = "";
		let namePosition: Position = position;
		if (this.peekKind() === "Identifier") {
			const idTok = this.consume();
			name = idTok.text;
			namePosition = this.posFromToken(idTok);
		} else {
			this.error(`member missing name, got '${this.peekKind()}'`);
			this.skipToNextMemberStart();
			return {
				context, kind, explicitContext, midiParams, name, inputs: [], outputs: [], body: [],
				position: { ...position, ...this.endPosition() }, namePosition,
			};
		}

		// Inputs pattern
		const inputs = this.parsePattern();

		// Arrow
		this.expect("Arrow");

		// Outputs pattern
		const outputs = this.parsePattern();

		// Body statements
		const body: Statement[] = [];
		while (this.isStatementStart()) {
			body.push(this.parseStatement());
		}

		return {
			context, kind, explicitContext, midiParams, name, inputs, outputs, body,
			position: { ...position, ...this.endPosition() }, namePosition,
		};
	}

	private isStatementStart(): boolean {
		const k = this.peekKind();
		return k === "Identifier" || k === "LParen" || k === "LSquare";
	}

	// --- Pattern ---

	private parsePattern(): PatternItem[] {
		if (this.peekKind() === "LParen") {
			this.consume();
			const items = this.parseCommaSeparated(() => this.parsePatternItem());
			this.expect("RParen");
			return items;
		}
		return this.parseCommaSeparated(() => this.parsePatternItem());
	}

	private parsePatternItem(): PatternItem | null {
		if (this.peekKind() !== "Identifier") return null;
		const nameTok = this.consume();
		let type: ExplicitType | undefined;
		if (this.peekKind() === "Colon") {
			this.consume();
			type = this.parseExplicitType();
		}
		return {
			name: nameTok.text,
			type,
			position: { ...this.posFromToken(nameTok), ...this.endPosition() },
		};
	}

	private parseExplicitType(): ExplicitType {
		let scope: ScopeKind | undefined;
		let width: WidthKind | undefined;
		let valueType: ValueTypeKind | undefined;

		while (this.atKinds("Static", "Dynamic", "Mono", "Stereo", "Generic", "NumberKw", "BoolKw", "Buffer")) {
			const k = this.peekKind();
			if (k === "Static") { this.consume(); scope = "Static"; }
			else if (k === "Dynamic") { this.consume(); scope = "Dynamic"; }
			else if (k === "Mono") { this.consume(); width = "Mono"; }
			else if (k === "Stereo") { this.consume(); width = "Stereo"; }
			else if (k === "Generic") { this.consume(); width = "Generic"; }
			else if (k === "NumberKw") { this.consume(); valueType = "Number"; }
			else if (k === "BoolKw") { this.consume(); valueType = "Bool"; }
			else if (k === "Buffer") { this.consume(); valueType = "Buffer"; }
		}

		return { scope, width, valueType };
	}

	// --- Statement ---

	private parseStatement(): Statement {
		const startTok = this.peek();
		const pattern = this.parsePattern();
		if (pattern.length === 0) {
			this.error("statement has no pattern");
		}
		if (!this.expect("Assign")) {
			return {
				pattern,
				expression: { kind: "Variable", name: "", position: this.posFromToken(startTok) },
				position: { ...this.posFromToken(startTok), ...this.endPosition() },
			};
		}
		const expr = this.parseExpression();
		return {
			pattern,
			expression: expr,
			position: { ...this.posFromToken(startTok), ...this.endPosition() },
		};
	}

	// --- Expression (precedence climbing) ---

	private parseExpression(): Expression {
		return this.parseConditional();
	}

	private parseConditional(): Expression {
		const left = this.parseFor();
		if (this.peekKind() === "Question") {
			this.consume();
			const thenBranch = this.parseExpression();
			this.expect("Colon");
			const elseBranch = this.parseExpression();
			return { kind: "Conditional", condition: left, thenBranch, elseBranch, position: this.posFromToken(left.position as any || { line: 0, character: 0 }) };
		}
		return left;
	}

	private parseFor(): Expression {
		if (this.peekKind() === "For") {
			const startTok = this.consume();
			const pos = this.posFromToken(startTok);

			// Check for buffer init: for <expr> [width] buffer <expr>
			const lookahead = this.tryPeekAhead();
			if (lookahead.isBufferInit) {
				// For already consumed above; lookahead restored this.pos to saved
				const length = this.parseExpression();
				let width: WidthKind | undefined;
				if (this.atKinds("Mono", "Stereo", "Generic")) {
					const w = this.peekKind();
					this.consume();
					width = w === "Mono" ? "Mono" : w === "Stereo" ? "Stereo" : "Generic";
				}
				if (this.expect("Buffer")) {
					const body = this.parseExpression();
					return { kind: "BufferInit", length, width, body, position: pos };
				}
			}

			// Regular for: for <id> to <count> <combinator> <body>
			// count uses parseUnary (not parseExpression) to avoid greedily
			// consuming the combinator as a binary operator
			// For already consumed above; lookahead restored this.pos to saved
			const varTok = this.consume();
			this.expect("To");
			const count = this.parseUnary();
			const combTok = this.consume();
			const combinatorPosition = this.posFromToken(combTok);
			if (!VALID_COMBINATORS.has(combTok.text)) {
				this.error(
					`Invalid combinator '${combTok.text}'. Permitted repetition combinators are 'add', 'max', 'min' and 'mul'`
				);
			}
			const combinator: ForCombinator = combTok.text as ForCombinator;
			const body = this.parseExpression();
			return { kind: "For", variable: varTok.text, count, combinator, combinatorPosition, body, position: pos };
		}
		return this.parseOr();
	}

	private tryPeekAhead(): { isBufferInit: boolean } {
		const saved = this.pos;
		let isBufferInit = false;

		this.skipPrimary();

		if (this.atKinds("Mono", "Stereo", "Generic")) {
			this.consume();
		}

		if (this.peekKind() === "Buffer") {
			this.consume();
			if (!this.atKinds("Global", "Note", "Module", "Function", "Instrument", "Eof")) {
				isBufferInit = true;
			}
		}

		this.pos = saved;
		return { isBufferInit };
	}

	private skipPrimary(): void {
		const k = this.peekKind();
		if (k === "LParen") {
			this.consume();
			let depth = 1;
			while (depth > 0 && this.peekKind() !== "Eof") {
				if (this.peekKind() === "LParen") depth++;
				if (this.peekKind() === "RParen") depth--;
				this.consume();
			}
		} else if (k === "LSquare") {
			this.consume();
			let depth = 1;
			while (depth > 0 && this.peekKind() !== "Eof") {
				if (this.peekKind() === "LSquare") depth++;
				if (this.peekKind() === "RSquare") depth--;
				this.consume();
			}
		} else if (k === "LBrace") {
			this.consume();
			let depth = 1;
			while (depth > 0 && this.peekKind() !== "Eof") {
				if (this.peekKind() === "LBrace") depth++;
				if (this.peekKind() === "RBrace") depth--;
				this.consume();
			}
		} else {
			this.consume();
		}
	}

	private parseOr(): Expression {
		return this.parseBinaryLeft(this.parseXor(), ["Or"]);
	}

	private parseXor(): Expression {
		return this.parseBinaryLeft(this.parseAnd(), ["Xor"]);
	}

	private parseAnd(): Expression {
		return this.parseBinaryLeft(this.parseCompare(), ["And"]);
	}

	private parseCompare(): Expression {
		return this.parseBinaryLeft(this.parseAdditive(), ["Eq", "Neq", "Less", "LessEq", "Greater", "GreaterEq"]);
	}

	private parseAdditive(): Expression {
		return this.parseBinaryLeft(this.parseMultiplicative(), ["Plus", "Minus", "MinusPlus"]);
	}

	private parseMultiplicative(): Expression {
		return this.parseBinaryLeft(this.parseUnary(), ["Multiply", "Divide"]);
	}

	private parseBinaryLeft(left: Expression, ops: TokenKind[]): Expression {
		while (this.atKinds(...ops)) {
			const opTok = this.consume();
			const right = this.parseUnary();
			left = {
				kind: "Binary",
				operator: opTok.text,
				left,
				right,
				position: this.posFromToken(opTok),
			};
		}
		return left;
	}

	// Unary: UnOp Primary | Unary "." Id (args)? | Unary "." Uint | Primary
	// (method calls and tuple index at unary level, not primary)

	private parseUnary(): Expression {
		if (this.peekKind() === "Minus" || this.peekKind() === "Not") {
			const opTok = this.consume();
			const operand = this.parseUnary();
			const op = opTok.kind === "Minus" ? "-" : "!";
			return { kind: "Unary", operator: op, operand, position: this.posFromToken(opTok) };
		}

		let result = this.parsePrimary();

		// Chain: .Uint (tuple index), .Id (args) (method call), [expr] (buffer index)
		while (this.peekKind() === "Dot" || this.peekKind() === "LSquare") {
			if (this.peekKind() === "Dot") {
				this.consume();
				if (this.peekKind() === "Decimal" || this.peekKind() === "Hex") {
					const idxTok = this.consume();
					result = { kind: "TupleIndex", target: result, index: parseInt(idxTok.text, 10), position: this.posFromToken(idxTok) };
				} else if (this.peekKind() === "Identifier") {
					const methodName = this.consume();
					const args = this.peekKind() === "LParen" ? this.parseCallArgs() : [];
					result = {
						kind: "Call",
						midiArgs: [],
						name: methodName.text,
						arguments: [result, ...args],
						position: this.posFromToken(methodName),
					};
				}
			} else if (this.peekKind() === "LSquare") {
				this.consume();
				const index = this.parseExpression();
				this.expect("RSquare");
				result = { kind: "BufferIndex", target: result, index, position: this.posFromToken(index as any || { line: 0, character: 0 }) };
			}
		}

		return result;
	}

	private parsePrimary(): Expression {
		const startTok = this.peek();
		const pos = this.posFromToken(startTok);
		const k = this.peekKind();

		// Number literal — but check first if it's a MIDI arg start (e.g. 1::proc(x))
		if (k === "Decimal" || k === "Hex" || k === "Inf") {
			if (this.isMidiArgStart()) {
				return this.parseCallOrVar();
			}
			this.consume();
			return { kind: "NumberLiteral", value: startTok.text, position: pos };
		}

		// Boolean literal
		if (k === "True") {
			this.consume();
			return { kind: "BoolLiteral", value: true, position: pos };
		}
		if (k === "False") {
			this.consume();
			return { kind: "BoolLiteral", value: false, position: pos };
		}

		// Buffer literal: { expr, expr }
		if (k === "LBrace") {
			this.consume();
			const elements = this.parseCommaSeparated(() => this.parseExpression());
			this.expect("RBrace");
			return { kind: "BufferLiteral", elements, position: pos };
		}

		// Merge: [ expr , expr ]
		if (k === "LSquare") {
			this.consume();
			const left = this.parseExpression();
			if (this.expect("Comma")) {
				const right = this.parseExpression();
				this.expect("RSquare");
				return { kind: "Merge", left, right, position: pos };
			}
			// [expr] without comma is not valid Zing — but consume gracefully
			this.expect("RSquare");
			return left;
		}

		// Tuple: ( expr, expr )
		if (k === "LParen") {
			this.consume();
			const elements = this.parseCommaSeparated(() => this.parseExpression());
			this.expect("RParen");
			return { kind: "Tuple", elements, position: pos };
		}

		// Call or variable — possibly with MIDI args
		if (this.isMidiArgStart() || k === "Identifier") {
			return this.parseCallOrVar();
		}

		// Fallback — consume unknown token or EOF
		if (k !== "Eof") {
			this.error(`unexpected token '${startTok.text}'`);
			this.consume();
			return { kind: "Variable", name: "", position: pos };
		}
		this.error("unexpected end of input while parsing expression");
		return { kind: "Variable", name: "", position: pos };
	}

	private parseCallOrVar(): Expression {
		const startTok = this.peek();
		const pos = this.posFromToken(startTok);

		// MIDI args
		const midiArgs: MidiMapping[] = [];
		while (this.isMidiArgStart()) {
			midiArgs.push(this.consumeMidiArg());
		}

		// Name (Identifier)
		if (this.peekKind() !== "Identifier") {
			if (midiArgs.length > 0) {
				const last = midiArgs[midiArgs.length - 1];
				const name = last.kind === "Named" ? last.name : "";
				return { kind: "Variable", name, position: this.posFromToken(startTok) };
			}
			return { kind: "Variable", name: "", position: pos };
		}

		const nameTok = this.consume();
		const name = nameTok.text;

		// Call: name(args)
		if (this.peekKind() === "LParen") {
			const args = this.parseCallArgs();
			return {
				kind: "Call",
				midiArgs,
				name,
				arguments: args,
				position: pos,
			};
		}

		return { kind: "Variable", name, position: pos };
	}

	private parseCallArgs(): Expression[] {
		this.consume("LParen");
		if (this.peekKind() === "RParen") {
			this.consume();
			return [];
		}
		const args = this.parseCommaSeparated(() => this.parseExpression());
		this.expect("RParen");
		return args;
	}

	// --- Helpers ---

	private parseCommaSeparated<T>(parseItem: () => T | null): T[] {
		const items: T[] = [];
		const first = parseItem();
		if (first !== null) {
			items.push(first);
			while (this.peekKind() === "Comma") {
				this.consume();
				const next = parseItem();
				if (next !== null) {
					items.push(next);
				}
			}
		}
		return items;
	}
}

export function parseTokens(tokens: Token[]): Program {
	const parser = new Parser(tokens);
	return parser.parse();
}