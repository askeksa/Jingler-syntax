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
	findEnclosingMember,
	findSymbolInIncludes,
	LookupResult
} from "./definitions";
import { channel } from "./logging";

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

function formatPattern(items: PatternItem[]): string | undefined {
	if (items.length === 0) return undefined;
	const parts = items.map(item => {
		const typeStr = formatType(item.type);
		return `${item.name}${typeStr ? ":" + typeStr : ""}`;
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
	params?: string[];
	outputDesc?: string;
}

export const BUILT_INS: Record<string, BuiltInInfo> = {
	"atan2": { kind: "function", signature: "atan2(x: mono, y: mono) → mono", description: "Two-argument arctangent.", args: 2, context: "Universal", memberKind: "Function", params: ["y coordinate", "x coordinate"], outputDesc: "angle in radians" },
	"ceil": { kind: "function", signature: "ceil(x: generic) → generic", description: "Ceiling.", args: 1, context: "Universal", memberKind: "Function", params: ["value to round up"], outputDesc: "smallest integer ≥ x" },
	"cos": { kind: "function", signature: "cos(x: mono) → mono", description: "Cosine.", args: 1, context: "Universal", memberKind: "Function", params: ["angle in radians"], outputDesc: "cosine value" },
	"exp2": { kind: "function", signature: "exp2(x: mono) → mono", description: "Power of 2.", args: 1, context: "Universal", memberKind: "Function", params: ["exponent"], outputDesc: "2 raised to the power of x" },
	"floor": { kind: "function", signature: "floor(x: generic) → generic", description: "Floor.", args: 1, context: "Universal", memberKind: "Function", params: ["value to round down"], outputDesc: "largest integer ≤ x" },
	"gate": { kind: "function", signature: "gate() → mono bool", description: "Reads the gate property of the current note. Note context only.", args: 0, context: "Note", memberKind: "Function", outputDesc: "true while note is held, false when released" },
	"gmdls": { kind: "function", signature: "gmdls(program: mono, bank: mono) → mono", description: "GM DLS sample mapping.", args: 2, context: "Universal", memberKind: "Function", params: ["GM program number (1–128)", "GM bank number (0–127)"], outputDesc: "mapped MIDI note number" },
	"index": { kind: "function", signature: "index(b: generic buffer) → mono", description: "Buffer indexing.", args: 1, context: "Universal", memberKind: "Function", params: ["buffer to index"], outputDesc: "current sample position within the buffer" },
	"key": { kind: "function", signature: "key() → mono", description: "Reads the key property of the current note. Note context only.", args: 0, context: "Note", memberKind: "Function", outputDesc: "MIDI note number (0–127)" },
	"left": { kind: "function", signature: "left(x: stereo) → mono", description: "Extracts the left channel from a stereo signal.", args: 1, context: "Universal", memberKind: "Function", params: ["stereo signal"], outputDesc: "left channel as mono" },
	"length": { kind: "function", signature: "length(b: generic buffer) → mono", description: "Buffer length.", args: 1, context: "Universal", memberKind: "Function", params: ["buffer"], outputDesc: "number of samples in the buffer" },
	"log2": { kind: "function", signature: "log2(x: mono) → mono", description: "Base-2 logarithm.", args: 1, context: "Universal", memberKind: "Function", params: ["value"], outputDesc: "log base 2 of x" },
	"max": { kind: "function", signature: "max(a: generic, b: generic) → generic", description: "Maximum of two values.", args: 2, context: "Universal", memberKind: "Function", params: ["first value", "second value"], outputDesc: "the larger of a and b" },
	"min": { kind: "function", signature: "min(a: generic, b: generic) → generic", description: "Minimum of two values.", args: 2, context: "Universal", memberKind: "Function", params: ["first value", "second value"], outputDesc: "the smaller of a and b" },
	"random": { kind: "function", signature: "random(min: mono, max: mono) → mono", description: "Random value in range.", args: 2, context: "Universal", memberKind: "Function", params: ["lower bound", "upper bound"], outputDesc: "random value between min and max" },
	"right": { kind: "function", signature: "right(x: stereo) → mono", description: "Extracts the right channel from a stereo signal.", args: 1, context: "Universal", memberKind: "Function", params: ["stereo signal"], outputDesc: "right channel as mono" },
	"round": { kind: "function", signature: "round(x: generic) → generic", description: "Round to nearest integer.", args: 1, context: "Universal", memberKind: "Function", params: ["value to round"], outputDesc: "nearest integer to x" },
	"samplerate": { kind: "function", signature: "samplerate() → mono", description: "Current audio sample rate in Hz.", args: 0, context: "Universal", memberKind: "Function", outputDesc: "sample rate (e.g., 44100)" },
	"sin": { kind: "function", signature: "sin(x: mono) → mono", description: "Sine.", args: 1, context: "Universal", memberKind: "Function", params: ["angle in radians"], outputDesc: "sine value" },
	"sincos": { kind: "function", signature: "sincos(x: mono) → (mono, mono)", description: "Sine and cosine.", args: 1, context: "Universal", memberKind: "Function", params: ["angle in radians"], outputDesc: "tuple of (sin x, cos x)" },
	"sqrt": { kind: "function", signature: "sqrt(x: generic) → generic", description: "Square root.", args: 1, context: "Universal", memberKind: "Function", params: ["value"], outputDesc: "square root of x" },
	"tan": { kind: "function", signature: "tan(x: mono) → mono", description: "Tangent.", args: 1, context: "Universal", memberKind: "Function", params: ["angle in radians"], outputDesc: "tangent value" },
	"trunc": { kind: "function", signature: "trunc(x: generic) → generic", description: "Truncate toward zero.", args: 1, context: "Universal", memberKind: "Function", params: ["value to truncate"], outputDesc: "integer part of x" },
	"velocity": { kind: "function", signature: "velocity() → mono", description: "Reads the velocity property of the current note. Note context only.", args: 0, context: "Note", memberKind: "Function", outputDesc: "MIDI velocity (0–127)" },
	"center": { kind: "function", signature: "center(x: stereo) → mono", description: "Average of left and right channels.", args: 1, context: "Universal", memberKind: "Function", params: ["stereo signal"], outputDesc: "(left + right) / 2" },
	"swap": { kind: "function", signature: "swap(x: stereo) → stereo", description: "Exchange left and right channels.", args: 1, context: "Universal", memberKind: "Function", params: ["stereo signal"], outputDesc: "stereo with channels swapped" },
	"pow": { kind: "function", signature: "pow(base: mono, exp: mono) → mono", description: "Base raised to exponent.", args: 2, context: "Universal", memberKind: "Function", params: ["base value", "exponent"], outputDesc: "base raised to the power of exp" },
	"cell": { kind: "module", signature: "cell(value: dynamic generic typeless, init: static generic typeless) → dynamic generic typeless", description: "Stateful value. Maintains a value across samples.", args: 2, context: "Universal", memberKind: "Module", params: ["value to accumulate", "initial value (static)"], outputDesc: "accumulated value" },
	"delay": { kind: "module", signature: "delay(value: dynamic generic typeless, samples: static mono number) → dynamic generic typeless", description: "Fixed delay line. Delay amount must be static.", args: 2, context: "Universal", memberKind: "Module", params: ["signal to delay", "delay in samples (static)"], outputDesc: "signal delayed by the given number of samples" },
	"dyndelay": { kind: "module", signature: "dyndelay(value: dynamic generic typeless, samples: dynamic mono number, max: static mono number) → dynamic generic typeless", description: "Variable delay line. Takes dynamic delay amount and static maximum.", args: 3, context: "Universal", memberKind: "Module", params: ["signal to delay", "delay in samples (dynamic)", "maximum delay in samples (static)"], outputDesc: "signal delayed by the variable amount" },
};

/* ------------------------------------------------------------------ */
/*  Markdown builders                                                  */
/* ------------------------------------------------------------------ */

function buildMemberHover(member: Member): string {
	const kindLabel = member.kind.toLowerCase();
	const inputs = formatPattern(member.inputs);
	const outputs = formatPattern(member.outputs);
	const sig = `${member.name}${inputs || ""}`;
	return `**${kindLabel}** ${sig} → ${outputs || "()"}`;
}

function buildParameterHover(param: Parameter): string {
	const parts: string[] = [];
	parts.push(`**parameter** ${param.name}`);
	parts.push(`${param.min} to ${param.max}`);
	if (param.defaultValue) {
		parts.push(`= ${param.defaultValue}`);
	}
	return parts.join(" ");
}

function buildVariableHover(name: string, stmt: Statement | undefined): string {
	const parts: string[] = [];
	parts.push(`**variable** ${name}`);
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
	parts.push(`**${builtin.kind}** ${builtin.signature}`);
	if (builtin.description) {
		parts.push(builtin.description);
	}
	if (builtin.params && builtin.params.length > 0) {
		parts.push("**inputs**");
		parts.push(builtin.params.map(p => `- ${p}`).join("\n"));
	}
	if (builtin.outputDesc) {
		parts.push("**output**");
		parts.push(builtin.outputDesc);
	}
	return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */
/*  Hover content builders                                             */
/* ------------------------------------------------------------------ */

function buildHoverFromTarget(target: HoverTarget): vscode.Hover | null {
	let content: string;
	if (target.member && !target.patternItem && !target.statement) {
		content = buildMemberHover(target.member);
	} else if (target.parameter) {
		content = buildParameterHover(target.parameter);
	} else if (target.patternItem && target.statement) {
		content = buildVariableHover(target.name, target.statement);
	} else if (target.patternItem && target.member) {
		const typeStr = formatType(target.patternItem.type);
		content = `**parameter** ${target.name}${typeStr ? ":" + typeStr : ""}`;
	} else {
		return null;
	}
	return new vscode.Hover(new vscode.MarkdownString(content));
}

function buildHoverFromLookupResult(result: LookupResult): vscode.Hover | null {
	if (result.member) {
		return new vscode.Hover(new vscode.MarkdownString(buildMemberHover(result.member)));
	}
	if (result.parameter) {
		return new vscode.Hover(new vscode.MarkdownString(buildParameterHover(result.parameter)));
	}
	return null;
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export let hoverProvider: vscode.HoverProvider = {
	async provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.Hover | null> {
		try {
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
			if (target) {
				return buildHoverFromTarget(target);
			}

			// Not found in current doc — check includes
			if (doc.ast.includes.length > 0) {
				const incPaths = doc.ast.includes.map(i => i.path);
				const incResult = await findSymbolInIncludes(incPaths, document.uri, symbol);
				if (incResult) {
					return buildHoverFromLookupResult(incResult);
				}
			}

			return null;
		} catch (err) {
			channel.appendLine(`[hover] failed for ${document.uri.fsPath}: ${err}`);
			return null;
		}
	}
};
