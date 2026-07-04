import * as vscode from 'vscode';
import { Token, Tokenizer } from "./tokenizer";
import { parseTokens } from "./parser";
import {
	Program, Member, Include, Parameter,
	PatternItem, Statement, Expression,
	MidiMapping, MidiNoteRange,
} from "./ast";
import { walkExpression, ExpressionVisitor } from "./expression_walk";

/* ------------------------------------------------------------------ */
/*  Legend — custom types mapped to TextMate scopes via               */
/*  package.json contributes.semanticTokenScopes                      */
/* ------------------------------------------------------------------ */

export const semanticLegend: vscode.SemanticTokensLegend = {
	tokenTypes: [
		// Zing-specific types (mapped to TextMate scopes in package.json)
		"zingToplevel",
		"zingToplevelModifier",
		"zingScope",
		"zingWidth",
		"zingType",
		"zingControl",
		"supportFunction",
		// Built-in types
		"comment",
		"string",
		"number",
		"operator",
		"variable",
		"function",
		"parameter",
	],
	tokenModifiers: [
		"declaration",
		"static",
	],
};

// Derived from legend — single source of truth for indices/modifiers
const TT: Record<string, number> = {};
semanticLegend.tokenTypes.forEach((t, i) => TT[t] = i);

const MOD: Record<string, number> = {};
semanticLegend.tokenModifiers.forEach((m, i) => MOD[m] = 1 << i);

interface SemanticTokenInfo {
	type: number;
	modifiers: number; // bitset
}

/* ------------------------------------------------------------------ */
/*  Built-in function names (supportFunction)                          */
/* ------------------------------------------------------------------ */

const BUILT_IN_FUNCTIONS = new Set([
	"atan2", "ceil", "cos", "exp2", "floor", "max", "min",
	"mlog2", "round", "sin", "sqrt", "tan", "trunc",
	"random", "center", "left", "right", "cell", "delay",
	"dyndelay", "samplerate", "gate", "key", "velocity",
]);

/* ------------------------------------------------------------------ */
/*  Tokenizer default mapping                                          */
/* ------------------------------------------------------------------ */

function tokenizerDefault(kind: string, text?: string): SemanticTokenInfo {
	switch (kind) {
		// toplevel keywords → zingToplevel
		case "Module": case "Function": case "Instrument":
		case "Include": case "Parameter":
		case "Buffer":
			return { type: TT.zingToplevel, modifiers: 0 };
		// context modifiers → zingToplevelModifier
		case "Global": case "Note":
			return { type: TT.zingToplevelModifier, modifiers: 0 };
		// scope → zingScope
		case "Static":
			return { type: TT.zingScope, modifiers: MOD.static };
		case "Dynamic":
			return { type: TT.zingScope, modifiers: 0 };
		// width → zingWidth
		case "Mono": case "Stereo": case "Generic":
			return { type: TT.zingWidth, modifiers: 0 };
		// value type → zingType
		case "NumberKw": case "BoolKw":
			return { type: TT.zingType, modifiers: 0 };
		// control flow → zingControl
		case "For": case "To":
			return { type: TT.zingControl, modifiers: 0 };
		// booleans & inf → number
		case "Inf": case "True": case "False":
			return { type: TT.number, modifiers: 0 };
		// numerics → number
		case "Hex": case "Decimal":
			return { type: TT.number, modifiers: 0 };
		// string → string
		case "String":
			return { type: TT.string, modifiers: 0 };
		// comment → comment
		case "Comment":
			return { type: TT.comment, modifiers: 0 };
		// operators → operator
		case "Plus": case "Minus": case "MinusPlus": case "Multiply": case "Divide":
		case "Eq": case "Neq": case "Less": case "LessEq":
		case "Greater": case "GreaterEq":
		case "Or": case "Xor": case "And":
		case "Not":
			return { type: TT.operator, modifiers: 0 };
		// punctuation → operator
		case "Question": case "Colon": case "ColonColon": case "Arrow":
		case "Dot": case "DotDot": case "Assign":
			return { type: TT.operator, modifiers: 0 };
		// delimiters → operator
		case "LParen": case "RParen":
		case "LSquare": case "RSquare":
		case "LBrace": case "RBrace":
		case "Comma":
			return { type: TT.operator, modifiers: 0 };
		// identifier — check for built-in functions, default → variable
		case "Identifier":
			if (text && BUILT_IN_FUNCTIONS.has(text)) {
				return { type: TT.supportFunction, modifiers: 0 };
			}
			return { type: TT.variable, modifiers: 0 };
		// fallback
		default:
			return { type: TT.variable, modifiers: 0 };
	}
}

/* ------------------------------------------------------------------ */
/*  AST → override map                                                 */
/* ------------------------------------------------------------------ */

function posKey(line: number, character: number): string {
	return `${line}:${character}`;
}

class AstWalker {
	private overrides = new Map<string, SemanticTokenInfo>();

	public walk(ast: Program): Map<string, SemanticTokenInfo> {
		for (const inc of ast.includes) {
			this.visitInclude(inc);
		}
		for (const param of ast.parameters) {
			this.visitParameter(param);
		}
		for (const member of ast.members) {
			this.visitMember(member);
		}
		return this.overrides;
	}

	private visitInclude(_inc: Include): void {
		// 'include' keyword already classified by tokenizer default
	}

	private visitParameter(param: Parameter): void {
		this.set(param.namePosition.line, param.namePosition.character, { type: TT.parameter, modifiers: MOD.declaration });
	}

	private visitMember(member: Member): void {
		for (const mp of member.midiParams) {
			this.set(mp.position.line, mp.position.character, { type: TT.parameter, modifiers: MOD.declaration });
		}

		this.set(member.namePosition.line, member.namePosition.character, { type: TT.function, modifiers: MOD.declaration });

		for (const item of member.inputs) {
			this.visitPatternItem(item);
		}

		for (const item of member.outputs) {
			this.visitPatternItem(item);
		}

		for (const stmt of member.body) {
			this.visitStatement(stmt);
		}
	}

	private visitPatternItem(item: PatternItem): void {
		this.set(item.position.line, item.position.character, { type: TT.parameter, modifiers: MOD.declaration });
	}

	private visitStatement(stmt: Statement): void {
		for (const item of stmt.pattern) {
			this.set(item.position.line, item.position.character, { type: TT.variable, modifiers: MOD.declaration });
		}
		this.visitExpression(stmt.expression);
	}

	private visitExpression(expr: Expression): void {
		const visitor: ExpressionVisitor = {
			visitCall: e => {
				for (const midi of e.midiArgs) {
					this.visitMidiMapping(midi);
				}
				this.set(e.position.line, e.position.character, { type: TT.function, modifiers: 0 });
			},
		};
		walkExpression(expr, visitor);
	}

	private visitMidiMapping(midi: MidiMapping): void {
		if (midi.kind === "Named") {
			this.set(midi.position.line, midi.position.character, { type: TT.parameter, modifiers: 0 });
		} else {
			this.visitMidiNoteRange(midi.range);
		}
	}

	private visitMidiNoteRange(range: MidiNoteRange): void {
		this.set(range.position.line, range.position.character, { type: TT.number, modifiers: 0 });
	}

	private set(line: number, character: number, info: SemanticTokenInfo): void {
		this.overrides.set(posKey(line, character), info);
	}
}

/* ------------------------------------------------------------------ */
/*  Token length helper                                                */
/* ------------------------------------------------------------------ */

function tokenLength(token: Token): number {
	return token.text.length;
}

/* ------------------------------------------------------------------ */
/*  Delta encoding                                                     */
/* ------------------------------------------------------------------ */

function encodeTokens(tokens: Token[], overrides: Map<string, SemanticTokenInfo>, _text: string): Uint32Array {
	const result: number[] = [];
	let prevLine = 0;
	let prevChar = 0;

	const sorted = [...tokens].sort((a, b) => {
		if (a.line !== b.line) return a.line - b.line;
		return a.character - b.character;
	});

	for (const tok of sorted) {
		if (tok.kind === "Eof") continue;

		const len = tokenLength(tok);
		const deltaLine = tok.line - prevLine;
		const deltaChar = tok.line !== prevLine ? tok.character : tok.character - prevChar;

		let info: SemanticTokenInfo;
		const key = posKey(tok.line, tok.character);
		if (overrides.has(key)) {
			info = overrides.get(key)!;
		} else {
			info = tokenizerDefault(tok.kind, tok.text);
		}

		result.push(deltaLine, deltaChar, len, info.type, info.modifiers);

		prevLine = tok.line;
		prevChar = tok.character;
	}

	return new Uint32Array(result);
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	public provideDocumentSemanticTokens(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.SemanticTokens> {
		try {
			const text = document.getText();
			const allTokens = new Tokenizer(text).tokenize();
			const ast = parseTokens(allTokens);

			const walker = new AstWalker();
			const overrides = walker.walk(ast);

			const tokens = encodeTokens(allTokens, overrides, text);

			return new vscode.SemanticTokens(tokens);
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error("SemanticTokensProvider error:", err);
			return new vscode.SemanticTokens(new Uint32Array(0));
		}
	}

	public releaseDocumentSemanticTokens(_tokens: vscode.SemanticTokens): void {
		// nothing to release
	}
}

export const semanticTokensProvider = new SemanticTokensProvider();
