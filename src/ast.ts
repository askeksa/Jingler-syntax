export interface Position {
	line: number;
	character: number;
	endLine?: number;
	endCharacter?: number;
}

export type ContextKind = "Global" | "Note" | "Universal";
export type MemberKind = "Module" | "Function" | "Instrument";
export type ScopeKind = "Static" | "Dynamic";
export type WidthKind = "Mono" | "Stereo" | "Generic";
export type ValueTypeKind = "Number" | "Bool" | "Buffer" | "Typeless";

export interface ExplicitType {
	scope: ScopeKind | undefined;
	width: WidthKind | undefined;
	valueType: ValueTypeKind | undefined;
}

export interface PatternItem {
	name: string;
	type: ExplicitType | undefined;
	position: Position;
}

// --- MIDI ---

export interface MidiNoteRange {
	start: number;   // MIDI note number 0–127 (255 = unspecified)
	end: number;     // MIDI note number 0–127 (255 = unspecified)
	position: Position;
}

export interface MidiValueMapping {
	kind: "Value";
	channel: number;
	range: MidiNoteRange;
	transposeTo: number;  // MIDI note number (255 = no transpose)
	position: Position;
}

export interface MidiNamedMapping {
	kind: "Named";
	name: string;
	position: Position;
}

export type MidiMapping = MidiValueMapping | MidiNamedMapping;

export interface MidiParam {
	name: string;
	position: Position;
}

export interface Parameter {
	name: string;
	min: string;
	max: string;
	defaultValue: string | undefined;
	position: Position;
	namePosition: Position;
}

export interface Member {
	context: ContextKind;
	kind: MemberKind;
	midiParams: MidiParam[];
	name: string;
	inputs: PatternItem[];
	outputs: PatternItem[];
	body: Statement[];
	position: Position;
	namePosition: Position;
}

export interface Include {
	path: string;
	position: Position;
	stringPosition?: Position;
}

export interface ParseError {
	message: string;
	position: Position;
}

export interface Program {
	includes: Include[];
	parameters: Parameter[];
	members: Member[];
	parseErrors: ParseError[];
}

// --- Statements ---

export interface AssignmentStatement {
	pattern: PatternItem[];
	expression: Expression;
	position: Position;
}

export type Statement = AssignmentStatement;

// --- Expressions ---

export type Expression =
	| NumberLiteralExpr
	| BoolLiteralExpr
	| VariableExpr
	| UnaryExpr
	| BinaryExpr
	| ConditionalExpr
	| CallExpr
	| TupleExpr
	| MergeExpr
	| TupleIndexExpr
	| BufferIndexExpr
	| BufferLiteralExpr
	| ForExpr
	| BufferInitExpr
	| ExpandExpr;

export interface NumberLiteralExpr {
	kind: "NumberLiteral";
	value: string;
	position: Position;
}

export interface BoolLiteralExpr {
	kind: "BoolLiteral";
	value: boolean;
	position: Position;
}

export interface VariableExpr {
	kind: "Variable";
	name: string;
	position: Position;
}

export interface UnaryExpr {
	kind: "Unary";
	operator: "-" | "!";
	operand: Expression;
	position: Position;
}

export interface BinaryExpr {
	kind: "Binary";
	operator: string;
	left: Expression;
	right: Expression;
	position: Position;
}

export interface ConditionalExpr {
	kind: "Conditional";
	condition: Expression;
	thenBranch: Expression;
	elseBranch: Expression;
	position: Position;
}

export interface CallExpr {
	kind: "Call";
	midiArgs: MidiMapping[];
	name: string;
	arguments: Expression[];
	position: Position;
}

export interface TupleExpr {
	kind: "Tuple";
	elements: Expression[];
	position: Position;
}

export interface MergeExpr {
	kind: "Merge";
	left: Expression;
	right: Expression;
	position: Position;
}

export interface TupleIndexExpr {
	kind: "TupleIndex";
	target: Expression;
	index: number;
	position: Position;
}

export interface BufferIndexExpr {
	kind: "BufferIndex";
	target: Expression;
	index: Expression;
	position: Position;
}

export interface BufferLiteralExpr {
	kind: "BufferLiteral";
	elements: Expression[];
	position: Position;
}

export type ForCombinator = "add" | "mul" | "max" | "min";

export interface ForExpr {
	kind: "For";
	variable: string;
	count: Expression;
	combinator: ForCombinator;
	combinatorPosition: Position;
	body: Expression;
	position: Position;
}

export interface BufferInitExpr {
	kind: "BufferInit";
	length: Expression;
	width: WidthKind | undefined;
	body: Expression;
	position: Position;
}

export interface ExpandExpr {
	kind: "Expand";
	expression: Expression;
	width: WidthKind;
	position: Position;
}