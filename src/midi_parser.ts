import { Token, TokenKind } from "./tokenizer";
import { Position, MidiParam, MidiMapping } from "./ast";

/* ------------------------------------------------------------------ */
/*  MIDI parser — extracted from parser.ts                             */
/* ------------------------------------------------------------------ */

const NOTE_BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface MidiParserContext {
	peek(): Token;
	peekKind(): TokenKind;
	peekText(): string;
	peekAhead(offset: number): TokenKind;
	consume(expected?: TokenKind): Token;
	expect(kind: TokenKind): Token | null;
	posFromToken(t: Token): Position;
	skipBracesToColonColon(): boolean;
}

export class MidiParser {
	private ctx: MidiParserContext;

	constructor(ctx: MidiParserContext) {
		this.ctx = ctx;
	}

	// Member declaration: only Id "::" (MidiParam in real grammar)
	public isMidiParamStart(): boolean {
		return this.ctx.peekKind() === "Identifier" && this.ctx.peekAhead(1) === "ColonColon";
	}

	// Call expression: Id "::" | Num "::" | Num {...} "::" (MidiArg in real grammar)
	public isMidiArgStart(): boolean {
		if (this.ctx.peekKind() === "Identifier" && this.ctx.peekAhead(1) === "ColonColon") return true;
		if (this.ctx.peekKind() === "Decimal" || this.ctx.peekKind() === "Hex") {
			if (this.ctx.peekAhead(1) === "ColonColon") return true;
			if (this.ctx.peekAhead(1) === "LBrace") {
				return this.ctx.skipBracesToColonColon();
			}
		}
		return false;
	}

	// Member declaration: Id "::" → MidiParam
	public consumeMidiParam(): MidiParam {
		const startTok = this.ctx.peek();
		const position = this.ctx.posFromToken(startTok);
		const name = this.ctx.consume().text;
		this.ctx.expect("ColonColon");
		return { name, position };
	}

	// Call expression: Uint "::" | Uint {...} "::" | Id "::" → MidiMapping
	public consumeMidiArg(): MidiMapping {
		const startTok = this.ctx.peek();
		const position = this.ctx.posFromToken(startTok);
		const k = this.ctx.peekKind();

		if (k === "Identifier") {
			const name = this.ctx.consume().text;
			this.ctx.expect("ColonColon");
			return { kind: "Named", name, position };
		}

		if (k === "Decimal" || k === "Hex") {
			const channelText = this.ctx.consume().text;
			const channel = parseInt(channelText, channelText.startsWith("0x") || channelText.startsWith("0X") ? 16 : 10);

			if (this.ctx.peekKind() === "LBrace") {
				this.ctx.consume(); // LBrace
				const { range, transposeTo } = this.parseMidiNoteRangeTranspose();
				this.ctx.expect("RBrace");
				this.ctx.expect("ColonColon");
				return { kind: "Value", channel, range, transposeTo, position };
			}

			this.ctx.expect("ColonColon");
			return {
				kind: "Value",
				channel,
				range: { start: 0, end: 127, position },
				transposeTo: 255,
				position,
			};
		}

		// Fallback
		this.ctx.consume();
		return { kind: "Named", name: "", position };
	}

	private parseMidiNoteRangeTranspose(): { range: { start: number; end: number; position: Position }; transposeTo: number } {
		const { start, end, position } = this.parseMidiNoteRange();
		let transposeTo = start;
		if (this.ctx.peekKind() === "Divide") {
			this.ctx.consume();
			transposeTo = this.parseMidiNote();
		}
		return { range: { start, end, position }, transposeTo };
	}

	// MidiNoteRange → MidiNote | ".." MidiNote | MidiNote ".." | MidiNote ".." MidiNote
	private parseMidiNoteRange(): { start: number; end: number; position: Position } {
		const pos = this.ctx.posFromToken(this.ctx.peek());

		if (this.ctx.peekKind() === "DotDot") {
			this.ctx.consume();
			const end = this.parseMidiNote();
			return { start: 255, end, position: pos };
		}

		const start = this.parseMidiNote();

		if (this.ctx.peekKind() === "DotDot") {
			this.ctx.consume();
			if (this.ctx.peekKind() === "RBrace") {
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
		const tok = this.ctx.consume();
		const text = tok.text;

		// Single token like "C4" or "C#4"
		const match = text.match(/^([A-Ga-g])([-#]?)(\d+)$/);
		if (match) {
			const base = NOTE_BASE[match[1].toUpperCase()];
			const sharp = match[2] === "#" ? 1 : 0;
			const octave = parseInt(match[3], 10);
			return base + sharp + octave * 12;
		}

		// Separate tokens: C # 4
		const base = NOTE_BASE[text.toUpperCase()];
		const sharp = this.ctx.peekKind() === "Identifier" && this.ctx.peekText() === "#" ? this.ctx.consume() : null;
		const octave = this.ctx.consume().text;
		const octaveNum = parseInt(octave, 10);
		return base + (sharp ? 1 : 0) + octaveNum * 12;
	}
}
