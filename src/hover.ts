import * as vscode from 'vscode';
import { parseZingDocument, ZingDocument } from "./document_symbols";
import {
	Member,
	Parameter,
	Statement,
	PatternItem,
	ExplicitType,
	Expression
} from "./ast";
import {
	ContextKind,
	MemberKind
} from "./ast";
import {
	symbolAt,
	findEnclosingMember
} from "./definitions";

/* ------------------------------------------------------------------ */
/*  Hover target                                                       */
/* ------------------------------------------------------------------ */

export interface HoverTarget {
	name: string;
	member?: Member;
	parameter?: Parameter;
	statement?: Statement;
	patternItem?: PatternItem;
}

function findAstNode(doc: ZingDocument, symbol: string, cursorLine: number): HoverTarget | undefined {
	const enclosing = findEnclosingMember(doc.ast, cursorLine);

	// Check assignment LHS on the current line first
	if (enclosing != undefined) {
		for (const stmt of enclosing.body) {
			if (stmt.position.line === cursorLine) {
				for (const item of stmt.pattern) {
					if (item.name === symbol) {
						return { name: symbol, member: enclosing, statement: stmt, patternItem: item };
					}
				}
			}
		}
	}

	// Check inputs/outputs (for references in expressions)
	if (enclosing != undefined) {
		for (const item of enclosing.inputs) {
			if (item.name === symbol) {
				return { name: symbol, member: enclosing, patternItem: item };
			}
		}
		for (const item of enclosing.outputs) {
			if (item.name === symbol) {
				return { name: symbol, member: enclosing, patternItem: item };
			}
		}
		// Check assignments from other lines
		for (const stmt of enclosing.body) {
			if (stmt.position.line !== cursorLine) {
				for (const item of stmt.pattern) {
					if (item.name === symbol) {
						return { name: symbol, member: enclosing, statement: stmt, patternItem: item };
					}
				}
			}
		}
	}

	// Check top-level members
	for (const member of doc.ast.members) {
		if (member.name === symbol) {
			return { name: symbol, member };
		}
	}

	// Check top-level parameters
	for (const param of doc.ast.parameters) {
		if (param.name === symbol) {
			return { name: symbol, parameter: param };
		}
	}

	return undefined;
}

/* ------------------------------------------------------------------ */
/*  Type formatting                                                    */
/* ------------------------------------------------------------------ */

function formatType(type: ExplicitType | undefined): string {
	if (!type) return "";
	const parts: string[] = [];
	if (type.scope) parts.push(type.scope.toLowerCase());
	if (type.width) parts.push(type.width.toLowerCase());
	if (type.valueType) parts.push(type.valueType.toLowerCase());
	return parts.length > 0 ? " " + parts.join(" ") : "";
}

function formatPattern(items: PatternItem[]): string {
	if (items.length === 0) return "()";
	const parts = items.map(item => {
		const typeStr = formatType(item.type);
		return `\`${item.name}\`${typeStr ? ":" + typeStr : ""}`;
	});
	return "(" + parts.join(", ") + ")";
}

/* ------------------------------------------------------------------ */
/*  Built-in signatures                                                */
/* ------------------------------------------------------------------ */

export interface BuiltInInfo {
	kind: string;
	signature: string;
	description: string;
	args: number;
	context: ContextKind;
	memberKind: MemberKind;
}

export const BUILT_INS: Record<string, BuiltInInfo> = {
	"atan2": { kind: "function", signature: "atan2(`x`: mono, `y`: mono) → mono", description: "Two-argument arctangent", args: 2, context: "Universal", memberKind: "Function" },
	"ceil": { kind: "function", signature: "ceil(`x`: generic) → generic", description: "Ceiling", args: 1, context: "Universal", memberKind: "Function" },
	"cos": { kind: "function", signature: "cos(`x`: mono) → mono", description: "Cosine", args: 1, context: "Universal", memberKind: "Function" },
	"exp2": { kind: "function", signature: "exp2(`x`: mono) → mono", description: "Power of 2", args: 1, context: "Universal", memberKind: "Function" },
	"floor": { kind: "function", signature: "floor(`x`: generic) → generic", description: "Floor", args: 1, context: "Universal", memberKind: "Function" },
	"gate": { kind: "function", signature: "gate() → mono bool", description: "Note gate status (note context)", args: 0, context: "Note", memberKind: "Function" },
	"gmdls": { kind: "function", signature: "gmdls(`program`: mono, `bank`: mono) → mono", description: "GM DLS sample mapping", args: 2, context: "Universal", memberKind: "Function" },
	"index": { kind: "function", signature: "index(`b`: generic buffer) → mono", description: "Buffer indexing", args: 1, context: "Universal", memberKind: "Function" },
	"key": { kind: "function", signature: "key() → mono", description: "MIDI note number (note context)", args: 0, context: "Note", memberKind: "Function" },
	"left": { kind: "function", signature: "left(`x`: stereo) → mono", description: "Left channel", args: 1, context: "Universal", memberKind: "Function" },
	"length": { kind: "function", signature: "length(`b`: generic buffer) → mono", description: "Buffer length", args: 1, context: "Universal", memberKind: "Function" },
	"log2": { kind: "function", signature: "log2(`x`: mono) → mono", description: "Base-2 logarithm", args: 1, context: "Universal", memberKind: "Function" },
	"max": { kind: "function", signature: "max(`a`: generic, `b`: generic) → generic", description: "Maximum of two values", args: 2, context: "Universal", memberKind: "Function" },
	"min": { kind: "function", signature: "min(`a`: generic, `b`: generic) → generic", description: "Minimum of two values", args: 2, context: "Universal", memberKind: "Function" },
	"random": { kind: "function", signature: "random(`min`: mono, `max`: mono) → mono", description: "Random in range", args: 2, context: "Universal", memberKind: "Function" },
	"right": { kind: "function", signature: "right(`x`: stereo) → mono", description: "Right channel", args: 1, context: "Universal", memberKind: "Function" },
	"round": { kind: "function", signature: "round(`x`: generic) → generic", description: "Round to nearest integer", args: 1, context: "Universal", memberKind: "Function" },
	"samplerate": { kind: "function", signature: "samplerate() → mono", description: "Sample rate", args: 0, context: "Universal", memberKind: "Function" },
	"sin": { kind: "function", signature: "sin(`x`: mono) → mono", description: "Sine", args: 1, context: "Universal", memberKind: "Function" },
	"sincos": { kind: "function", signature: "sincos(`x`: mono) → (mono, mono)", description: "Sine and cosine", args: 1, context: "Universal", memberKind: "Function" },
	"sqrt": { kind: "function", signature: "sqrt(`x`: generic) → generic", description: "Square root", args: 1, context: "Universal", memberKind: "Function" },
	"tan": { kind: "function", signature: "tan(`x`: mono) → mono", description: "Tangent", args: 1, context: "Universal", memberKind: "Function" },
	"trunc": { kind: "function", signature: "trunc(`x`: generic) → generic", description: "Truncate to integer", args: 1, context: "Universal", memberKind: "Function" },
	"velocity": { kind: "function", signature: "velocity() → mono", description: "Note velocity (note context)", args: 0, context: "Note", memberKind: "Function" },
	"center": { kind: "function", signature: "center(`x`: stereo) → mono", description: "Center channel (precompiled)", args: 1, context: "Universal", memberKind: "Function" },
	"swap": { kind: "function", signature: "swap(`x`: stereo) → stereo", description: "Swap channels (precompiled)", args: 1, context: "Universal", memberKind: "Function" },
	"pow": { kind: "function", signature: "pow(`base`: mono, `exp`: mono) → mono", description: "Power (precompiled)", args: 2, context: "Universal", memberKind: "Function" },
	"cell": { kind: "module", signature: "cell(`value`: dynamic typeless, `init`: static typeless) → dynamic typeless", description: "Stateful value with update", args: 2, context: "Universal", memberKind: "Module" },
	"delay": { kind: "module", signature: "delay(`value`: dynamic typeless, `samples`: static mono number) → dynamic typeless", description: "Fixed delay line", args: 2, context: "Universal", memberKind: "Module" },
	"dyndelay": { kind: "module", signature: "dyndelay(`value`: dynamic typeless, `samples`: dynamic mono number, `max`: static mono number) → dynamic typeless", description: "Variable delay", args: 3, context: "Universal", memberKind: "Module" },
};

/* ------------------------------------------------------------------ */
/*  Markdown builders                                                  */
/* ------------------------------------------------------------------ */

function buildMemberHover(member: Member): string {
	const kindLabel = member.kind.toLowerCase();
	const parts: string[] = [];
	parts.push(`**${kindLabel}** \`${member.name}\``);
	parts.push(formatPattern(member.inputs));
	parts.push("→");
	parts.push(formatPattern(member.outputs));
	return parts.join(" ");
}

function buildParameterHover(param: Parameter): string {
	const parts: string[] = [];
	parts.push(`**parameter** \`${param.name}\``);
	parts.push(`${param.min} to ${param.max}`);
	if (param.defaultValue) {
		parts.push(`= ${param.defaultValue}`);
	}
	return parts.join(" ");
}

function buildVariableHover(name: string, stmt: Statement | undefined): string {
	const parts: string[] = [];
	parts.push(`**variable** \`${name}\``);
	if (stmt != undefined) {
		parts.push("— assigned:");
		parts.push(formatExpressionForHover(stmt.expression));
	}
	return parts.join(" ");
}

function formatExpressionForHover(expr: Expression): string {
	switch (expr.kind) {
		case "NumberLiteral":
			return expr.value;
		case "BoolLiteral":
			return expr.value ? "true" : "false";
		case "Variable":
			return `\`${expr.name}\``;
		case "Unary":
			return `${expr.operator}${formatExpressionForHover(expr.operand)}`;
		case "Binary":
			return `${formatExpressionForHover(expr.left)} ${expr.operator} ${formatExpressionForHover(expr.right)}`;
		case "Conditional":
			return `${formatExpressionForHover(expr.condition)} ? ${formatExpressionForHover(expr.thenBranch)} : ${formatExpressionForHover(expr.elseBranch)}`;
		case "Call":
			return `\`${expr.name}\`(${expr.arguments.map(formatExpressionForHover).join(", ")})`;
		case "Tuple":
			return `(${expr.elements.map(formatExpressionForHover).join(", ")})`;
		case "Merge":
			return `[${formatExpressionForHover(expr.left)}, ${formatExpressionForHover(expr.right)}]`;
		case "TupleIndex":
			return `${formatExpressionForHover(expr.target)}.${expr.index}`;
		case "BufferIndex":
			return `${formatExpressionForHover(expr.target)}[${formatExpressionForHover(expr.index)}]`;
		case "BufferLiteral":
			return `{${expr.elements.map(formatExpressionForHover).join(", ")}}`;
		case "For":
			return `for ${expr.variable} to ${formatExpressionForHover(expr.count)} ${expr.combinator} ${formatExpressionForHover(expr.body)}`;
		case "BufferInit":
			return `for ${formatExpressionForHover(expr.length)} ${expr.width ? expr.width.toLowerCase() + " " : ""}buffer ${formatExpressionForHover(expr.body)}`;
		case "Expand":
			return formatExpressionForHover(expr.expression);
		default:
			return "";
	}
}

function buildBuiltInHover(name: string): string | undefined {
	const builtin = BUILT_INS[name];
	if (!builtin) return undefined;
	const parts: string[] = [];
	parts.push(`**${builtin.kind}** \`${name}\``);
	parts.push(builtin.signature);
	if (builtin.description) {
		parts.push(builtin.description);
	}
	return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export let hoverProvider: vscode.HoverProvider = {
	async provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.Hover | null> {
		const line = document.lineAt(position.line).text;
		const symbol = symbolAt(line, position.character);
		if (!symbol) return null;

		// Check built-ins first
		const builtIn = buildBuiltInHover(symbol);
		if (builtIn) {
			return new vscode.Hover(new vscode.MarkdownString(builtIn));
		}

		// Look up in document
		const doc = parseZingDocument(document.getText(), document.uri);
		const target = findAstNode(doc, symbol, position.line);
		if (!target) return null;

		let content: string;
		if (target.member && !target.patternItem && !target.statement) {
			content = buildMemberHover(target.member);
		} else if (target.parameter) {
			content = buildParameterHover(target.parameter);
		} else if (target.patternItem && target.statement) {
			content = buildVariableHover(target.name, target.statement);
		} else if (target.patternItem && target.member) {
			const typeStr = formatType(target.patternItem.type);
			content = `**parameter** \`${target.name}\`${typeStr ? ":" + typeStr : ""}`;
		} else {
			return null;
		}

		return new vscode.Hover(new vscode.MarkdownString(content));
	}
};
