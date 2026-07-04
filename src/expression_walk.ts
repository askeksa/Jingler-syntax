import {
	BinaryExpr,
	BoolLiteralExpr,
	BufferIndexExpr,
	BufferInitExpr,
	BufferLiteralExpr,
	CallExpr,
	ConditionalExpr,
	ExpandExpr,
	Expression,
	ForExpr,
	MergeExpr,
	NumberLiteralExpr,
	TupleExpr,
	TupleIndexExpr,
	UnaryExpr,
	VariableExpr,
} from "./ast";

/* ------------------------------------------------------------------ */
/*  Expression visitor interface                                       */
/* ------------------------------------------------------------------ */

export interface ExpressionVisitor {
	visitNumberLiteral?(expr: NumberLiteralExpr): void;
	visitBoolLiteral?(expr: BoolLiteralExpr): void;
	visitVariable?(expr: VariableExpr): void;
	visitUnary?(expr: UnaryExpr): void;
	visitBinary?(expr: BinaryExpr): void;
	visitConditional?(expr: ConditionalExpr): void;
	visitCall?(expr: CallExpr): void;
	visitTuple?(expr: TupleExpr): void;
	visitMerge?(expr: MergeExpr): void;
	visitTupleIndex?(expr: TupleIndexExpr): void;
	visitBufferIndex?(expr: BufferIndexExpr): void;
	visitBufferLiteral?(expr: BufferLiteralExpr): void;
	visitFor?(expr: ForExpr): void;
	visitBufferInit?(expr: BufferInitExpr): void;
	visitExpand?(expr: ExpandExpr): void;
}

/* ------------------------------------------------------------------ */
/*  Walk all child expressions of a node                               */
/* ------------------------------------------------------------------ */

function walkChildren(expr: Expression, visitor: ExpressionVisitor): void {
	switch (expr.kind) {
		case "NumberLiteral":
			visitor.visitNumberLiteral?.(expr);
			break;
		case "BoolLiteral":
			visitor.visitBoolLiteral?.(expr);
			break;
		case "Variable":
			visitor.visitVariable?.(expr);
			break;
		case "Unary":
			visitor.visitUnary?.(expr);
			walkExpression(expr.operand, visitor);
			break;
		case "Binary":
			visitor.visitBinary?.(expr);
			walkExpression(expr.left, visitor);
			walkExpression(expr.right, visitor);
			break;
		case "Conditional":
			visitor.visitConditional?.(expr);
			walkExpression(expr.condition, visitor);
			walkExpression(expr.thenBranch, visitor);
			walkExpression(expr.elseBranch, visitor);
			break;
		case "Call":
			visitor.visitCall?.(expr);
			expr.arguments.forEach(a => walkExpression(a, visitor));
			break;
		case "Tuple":
			visitor.visitTuple?.(expr);
			expr.elements.forEach(e => walkExpression(e, visitor));
			break;
		case "Merge":
			visitor.visitMerge?.(expr);
			walkExpression(expr.left, visitor);
			walkExpression(expr.right, visitor);
			break;
		case "TupleIndex":
			visitor.visitTupleIndex?.(expr);
			walkExpression(expr.target, visitor);
			break;
		case "BufferIndex":
			visitor.visitBufferIndex?.(expr);
			walkExpression(expr.target, visitor);
			walkExpression(expr.index, visitor);
			break;
		case "BufferLiteral":
			visitor.visitBufferLiteral?.(expr);
			expr.elements.forEach(e => walkExpression(e, visitor));
			break;
		case "For":
			visitor.visitFor?.(expr);
			walkExpression(expr.count, visitor);
			walkExpression(expr.body, visitor);
			break;
		case "BufferInit":
			visitor.visitBufferInit?.(expr);
			walkExpression(expr.length, visitor);
			walkExpression(expr.body, visitor);
			break;
		case "Expand":
			visitor.visitExpand?.(expr);
			walkExpression(expr.expression, visitor);
			break;
	}
}

export function walkExpression(expr: Expression, visitor: ExpressionVisitor): void {
	walkChildren(expr, visitor);
}

/* ------------------------------------------------------------------ */
/*  Check if an expression is a cell/delay/dyndelay call               */
/* ------------------------------------------------------------------ */

export const CELL_DELAY_NAMES = new Set(["cell", "delay", "dyndelay"]);

export function isCellOrDelay(name: string): boolean {
	return CELL_DELAY_NAMES.has(name);
}
