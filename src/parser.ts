import { Token, TokenKind, filterTokens } from "./tokenizer";
import {
	Position, ContextKind, MemberKind, WidthKind,
	ExplicitType, PatternItem, MidiParam, MidiMapping,
	Parameter, Member, Include, Program, ParseError,
	Statement,
	Expression, ForCombinator,
} from "./ast";
import { MidiParser, MidiParserContext } from "./midi_parser";

const VALID_COMBINATORS = new Set(["add", "max", "min", "mul"]);

const TYPE_TOKENS: Record<string, (t: ExplicitType) => void> = {
	Static:  t => { t.scope = "Static"; },
	Dynamic: t => { t.scope = "Dynamic"; },
	Mono:    t => { t.width = "Mono"; },
	Stereo:  t => { t.width = "Stereo"; },
	Generic: t => { t.width = "Generic"; },
	NumberKw: t => { t.valueType = "Number"; },
	BoolKw:  t => { t.valueType = "Bool"; },
	Buffer:  t => { t.valueType = "Buffer"; },
};

const TYPE_TOKEN_KINDS = new Set<string>(Object.keys(TYPE_TOKENS));

class Parser implements MidiParserContext {
	private tokens: Token[];
	private pos: number = 0;
	private errors: ParseError[] = [];
	private midi: MidiParser;

	constructor(tokens: Token[]) {
		this.tokens = filterTokens(tokens);
		this.midi = new MidiParser(this);
	}

	private error(message: string): void {
		const tok = this.peek();
		this.errors.push({ message, position: this.posFromToken(tok) });
	}

	// --- MidiParserContext members (public for interface) ---

	public peek(): Token {
		return this.tokens[this.pos] || { kind: "Eof", text: "", line: 0, character: 0 };
	}

	public peekKind(): TokenKind {
		return this.peek().kind;
	}

	public peekText(): string {
		return this.peek().text;
	}

	public peekAhead(offset: number): TokenKind {
		return this.tokens[this.pos + offset]?.kind || "Eof";
	}

	public consume(expected?: TokenKind): Token {
		const t = this.peek();
		if (expected && t.kind !== expected) {
			// skip — parser is lenient
		}
		this.pos++;
		return t;
	}

	public expect(kind: TokenKind): Token | null {
		if (this.peekKind() === kind) {
			return this.consume();
		}
		this.error(`expected '${kind}', got '${this.peekKind()}'`);
		return null;
	}

	public posFromToken(t: Token): Position {
		return { line: t.line, character: t.character };
	}

	// --- Internal helpers ---

	private atKinds(...kinds: TokenKind[]): boolean {
		return kinds.includes(this.peekKind());
	}

	private endPosition(): { endLine: number; endCharacter: number } {
		const t = this.pos > 0 ? this.tokens[this.pos - 1] : this.peek();
		return { endLine: t.line, endCharacter: t.character + t.text.length };
	}

	// --- Bracket helpers ---

	private skipBracketBlock(open: TokenKind, close: TokenKind): void {
		this.consume(); // consume opening bracket
		let depth = 1;
		while (depth > 0 && this.peekKind() !== "Eof") {
			if (this.peekKind() === open) depth++;
			if (this.peekKind() === close) depth--;
			this.consume();
		}
	}

	// Lookahead: skip Num + LBrace, traverse braces, check for ColonColon
	public skipBracesToColonColon(): boolean {
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
		if (this.midi.isMidiParamStart()) {
			const saved = this.pos;
			while (this.midi.isMidiParamStart()) {
				this.midi.consumeMidiParam();
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
		while (this.midi.isMidiParamStart()) {
			midiParams.push(this.midi.consumeMidiParam());
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
		const type: ExplicitType = { scope: undefined, width: undefined, valueType: undefined };
		while (TYPE_TOKEN_KINDS.has(this.peekKind())) {
			const k = this.peekKind();
			this.consume();
			TYPE_TOKENS[k as string](type);
		}
		return type;
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
		const expr = this.parseExpression() || { kind: "Variable", name: "", position: this.posFromToken(startTok) };
		return {
			pattern,
			expression: expr,
			position: { ...this.posFromToken(startTok), ...this.endPosition() },
		};
	}

	// --- Expression (precedence climbing) ---

	private parseExpression(): Expression | null {
		return this.parseConditional();
	}

	private parseConditional(): Expression | null {
		const left = this.parseFor();
		if (!left) return null;
		if (this.peekKind() === "Question") {
			this.consume();
			const thenBranch = this.parseExpression() || { kind: "Variable", name: "", position: left.position };
			this.expect("Colon");
			const elseBranch = this.parseExpression() || { kind: "Variable", name: "", position: left.position };
			return { kind: "Conditional", condition: left, thenBranch, elseBranch, position: left.position };
		}
		return left;
	}

	private parseFor(): Expression | null {
		if (this.peekKind() === "For") {
			const startTok = this.consume();
			const pos = this.posFromToken(startTok);

			// Check for buffer init: for <expr> [width] buffer <expr>
			const lookahead = this.tryPeekAhead();
			if (lookahead.isBufferInit) {
				// For already consumed above; lookahead restored this.pos to saved
				const length = this.parseExpression() || { kind: "Variable", name: "", position: pos };
				let width: WidthKind | undefined;
				if (this.atKinds("Mono", "Stereo", "Generic")) {
					const w = this.peekKind();
					this.consume();
					width = w === "Mono" ? "Mono" : w === "Stereo" ? "Stereo" : "Generic";
				}
				if (this.expect("Buffer")) {
					const body = this.parseExpression() || { kind: "Variable", name: "", position: pos };
					return { kind: "BufferInit", length, width, body, position: pos };
				}
			}

			// Regular for: for <id> to <count> <combinator> <body>
			// count uses parseUnary (not parseExpression) to avoid greedily
			// consuming the combinator as a binary operator
			// For already consumed above; lookahead restored this.pos to saved
			const varTok = this.consume();
			this.expect("To");
			const count = this.parseUnary() || { kind: "Variable", name: "", position: pos };
			const combTok = this.consume();
			const combinatorPosition = this.posFromToken(combTok);
			if (!VALID_COMBINATORS.has(combTok.text)) {
				this.error(
					`Invalid combinator '${combTok.text}'. Permitted repetition combinators are 'add', 'max', 'min' and 'mul'`
				);
			}
			const combinator: ForCombinator = combTok.text as ForCombinator;
			const body = this.parseExpression() || { kind: "Variable", name: "", position: pos };
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
			this.skipBracketBlock("LParen", "RParen");
		} else if (k === "LSquare") {
			this.skipBracketBlock("LSquare", "RSquare");
		} else if (k === "LBrace") {
			this.skipBracketBlock("LBrace", "RBrace");
		} else {
			this.consume();
		}
	}

	private parseOr(): Expression | null {
		return this.parseBinaryLeft(this.parseXor(), ["Or"], () => this.parseXor());
	}

	private parseXor(): Expression | null {
		return this.parseBinaryLeft(this.parseAnd(), ["Xor"], () => this.parseAnd());
	}

	private parseAnd(): Expression | null {
		return this.parseBinaryLeft(this.parseCompare(), ["And"], () => this.parseCompare());
	}

	private parseCompare(): Expression | null {
		return this.parseBinaryLeft(this.parseAdditive(), ["Eq", "Neq", "Less", "LessEq", "Greater", "GreaterEq"], () => this.parseAdditive());
	}

	private parseAdditive(): Expression | null {
		return this.parseBinaryLeft(this.parseMultiplicative(), ["Plus", "Minus", "MinusPlus"], () => this.parseMultiplicative());
	}

	private parseMultiplicative(): Expression | null {
		return this.parseBinaryLeft(this.parseUnary(), ["Multiply", "Divide"], () => this.parseUnary());
	}

	private parseBinaryLeft(left: Expression | null, ops: TokenKind[], parseRight: () => Expression | null): Expression | null {
		if (!left) return null;
		while (this.atKinds(...ops)) {
			const opTok = this.consume();
			const right = parseRight();
			if (!right) {
				break;
			}
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

	// Unary: UnOp Primary | Primary with postfix chain (.Uint, .Id(args), [expr])

	private parseUnary(): Expression | null {
		if (this.peekKind() === "Minus" || this.peekKind() === "Not") {
			const opTok = this.consume();
			const operand = this.parseUnary();
			if (!operand) return null;
			const op = opTok.kind === "Minus" ? "-" : "!";
			return { kind: "Unary", operator: op, operand, position: this.posFromToken(opTok) };
		}

		return this.parsePostfixChain(this.parsePrimary());
	}

	// Postfix chain: .Uint (tuple index), .Id(args) (method call), [expr] (buffer index)
	private parsePostfixChain(expr: Expression | null): Expression | null {
		if (!expr) return null;
		let result: Expression = expr;
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
				const index = this.parseExpression() || { kind: "Variable", name: "", position: this.posFromToken(this.peek()) };
				this.expect("RSquare");
				result = { kind: "BufferIndex", target: result, index, position: this.posFromToken(index as any || { line: 0, character: 0 }) };
			}
		}
		return result;
	}

	private parsePrimary(): Expression | null {
		const startTok = this.peek();
		const pos = this.posFromToken(startTok);
		const k = this.peekKind();

		// Number literal — but check first if it's a MIDI arg start (e.g. 1::proc(x))
		if (k === "Decimal" || k === "Hex" || k === "Inf") {
			if (this.midi.isMidiArgStart()) {
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
			const left = this.parseExpression() || { kind: "Variable", name: "", position: pos };
			if (this.expect("Comma")) {
				const right = this.parseExpression() || { kind: "Variable", name: "", position: pos };
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
		if (this.midi.isMidiArgStart() || k === "Identifier") {
			return this.parseCallOrVar();
		}

		// Fallback — do NOT consume, signal failure
		if (k !== "Eof") {
			this.error(`unexpected token '${startTok.text}'`);
			return null;
		}
		this.error("unexpected end of input while parsing expression");
		return null;
	}

	private parseCallOrVar(): Expression {
		const startTok = this.peek();
		const pos = this.posFromToken(startTok);

		// MIDI args
		const midiArgs: MidiMapping[] = [];
		while (this.midi.isMidiArgStart()) {
			midiArgs.push(this.midi.consumeMidiArg());
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
