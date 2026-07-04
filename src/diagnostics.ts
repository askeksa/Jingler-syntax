import * as vscode from 'vscode';
import { parseZingDocument, ZingDocument } from "./document_symbols";
import {
	Expression,
	Member,
	Program,
} from "./ast";
import { walkExpression, isCellOrDelay, ExpressionVisitor } from "./expression_walk";
import { BUILT_INS } from "./hover";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface IdentRef {
	name: string;
	position: { line: number; character: number };
}

function refRange(ref: IdentRef): vscode.Range {
	return new vscode.Range(
		new vscode.Position(ref.position.line, ref.position.character),
		new vscode.Position(ref.position.line, ref.position.character + ref.name.length)
	);
}

function errorDiagnostic(range: vscode.Range, message: string): vscode.Diagnostic {
	return new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
}

/* ------------------------------------------------------------------ */
/*  Collect ALL defined names in the program (no line awareness)       */
/* ------------------------------------------------------------------ */

function collectAllDefinedNames(ast: Program): Set<string> {
	const names = new Set<string>();
	for (const param of ast.parameters) {
		names.add(param.name);
	}
	for (const member of ast.members) {
		names.add(member.name);
	}
	return names;
}

/* ------------------------------------------------------------------ */
/*  Collect ALL defined names within a member (no line awareness)      */
/*  Also returns for-loop variable info for scope checking             */
/* ------------------------------------------------------------------ */

interface ForLoopVar {
	name: string;
	bodyStart: number;
	bodyEnd: number;
}

function collectMemberDefinitions(
	member: Member,
	parameters: readonly { name: string; position: { line: number } }[]
): { definitions: Map<string, number>; forLoopVars: ForLoopVar[] } {
	const definitions = new Map<string, number>();
	const forLoopVars: ForLoopVar[] = [];

	for (const param of parameters) {
		definitions.set(param.name, param.position.line);
	}

	for (const item of member.inputs) {
		definitions.set(item.name, item.position.line);
	}
	for (const item of member.outputs) {
		definitions.set(item.name, item.position.line);
	}

	for (const stmt of member.body) {
		for (const item of stmt.pattern) {
			definitions.set(item.name, stmt.position.line);
		}
	}

	const visitor: ExpressionVisitor = {
		visitFor: expr => {
			const bodyStart = expr.body.position.line;
			const bodyEnd = expr.body.position.endLine ?? bodyStart;
			forLoopVars.push({ name: expr.variable, bodyStart, bodyEnd });
		},
	};
	for (const stmt of member.body) {
		walkExpression(stmt.expression, visitor);
	}

	return { definitions, forLoopVars };
}

/* ------------------------------------------------------------------ */
/*  Expression walker for diagnostics                                  */
/*  Checks: unresolved, forward refs, for-loop scope                   */
/* ------------------------------------------------------------------ */

interface DiagnosticWalkResult {
	refs: IdentRef[];
	allowedFwdRefs: Set<string>;
	forLoopOutOfScope: Array<{ name: string; line: number; character: number }>;
}

function walkExpressionForDiagnostics(
	expr: Expression,
	definitions: Map<string, number>,
	forLoopVars: ForLoopVar[],
	inCellOrDelay: boolean
): DiagnosticWalkResult {
	const refs: IdentRef[] = [];
	const allowedFwdRefs = new Set<string>();
	const forLoopOutOfScope: Array<{ name: string; line: number; character: number }> = [];
	const forVarMap = new Map<string, { bodyStart: number; bodyEnd: number }>();
	for (const v of forLoopVars) {
		forVarMap.set(v.name, { bodyStart: v.bodyStart, bodyEnd: v.bodyEnd });
	}

	function walk(e: Expression, inCell: boolean): void {
		switch (e.kind) {
			case "Variable": {
				refs.push({ name: e.name, position: e.position });
				const forVar = forVarMap.get(e.name);
				if (forVar) {
					if (e.position.line < forVar.bodyStart || e.position.line > forVar.bodyEnd) {
						forLoopOutOfScope.push({
							name: e.name,
							line: e.position.line,
							character: e.position.character,
						});
					}
				}
				break;
			}
			case "Unary":
				walk(e.operand, inCell);
				break;
			case "Binary":
				walk(e.left, inCell);
				walk(e.right, inCell);
				break;
			case "Conditional":
				walk(e.condition, inCell);
				walk(e.thenBranch, inCell);
				walk(e.elseBranch, inCell);
				break;
			case "Call": {
				refs.push({ name: e.name, position: e.position });
				const isCell = isCellOrDelay(e.name);
				if (isCell) {
					for (const arg of e.arguments) {
						collectFwdRefs(arg, definitions, allowedFwdRefs);
					}
				}
				e.arguments.forEach(arg => walk(arg, isCell));
				break;
			}
			case "Tuple":
			case "BufferLiteral":
				e.elements.forEach(el => walk(el, inCell));
				break;
			case "Merge":
				walk(e.left, inCell);
				walk(e.right, inCell);
				break;
			case "TupleIndex":
				walk(e.target, inCell);
				break;
			case "BufferIndex":
				walk(e.target, inCell);
				walk(e.index, inCell);
				break;
			case "For": {
				walk(e.count, inCell);
				const prev = forVarMap.get(e.variable);
				const bodyStart = e.body.position.line;
				const bodyEnd = e.body.position.endLine ?? bodyStart;
				forVarMap.set(e.variable, { bodyStart, bodyEnd });
				walk(e.body, inCell);
				if (prev) {
					forVarMap.set(e.variable, prev);
				} else {
					forVarMap.delete(e.variable);
				}
				break;
			}
			case "BufferInit":
				walk(e.length, inCell);
				walk(e.body, inCell);
				break;
			case "Expand":
				walk(e.expression, inCell);
				break;
			default:
				break;
		}
	}

	walk(expr, inCellOrDelay);
	return { refs, allowedFwdRefs, forLoopOutOfScope };
}

/* Collect forward refs from all variable references in an expression */
function collectFwdRefs(
	expr: Expression,
	definitions: Map<string, number>,
	allowedFwdRefs: Set<string>
): void {
	walkExpression(expr, {
		visitVariable: e => {
			const defLine = definitions.get(e.name);
			if (defLine != undefined && e.position.line < defLine) {
				allowedFwdRefs.add(e.name);
			}
		},
	});
}

/* ------------------------------------------------------------------ */
/*  Resolve an identifier – returns true if it can be resolved        */
/* ------------------------------------------------------------------ */

function isBuiltIn(name: string): boolean {
	return name in BUILT_INS;
}

async function resolveIdentifier(
	doc: ZingDocument,
	name: string,
	refLine: number,
	memberDefinitions: Map<string, number> | null
): Promise<boolean> {
	if (isBuiltIn(name)) return true;

	// Local scope: enclosing member inputs/outputs + body assignments
	if (memberDefinitions != null && memberDefinitions.has(name)) return true;

	// Top-level scope: parameters + members
	const allNames = collectAllDefinedNames(doc.ast);
	if (allNames.has(name)) return true;

	// Include chain: symbols from included files
	return await resolveInIncludes(doc, name);
}

async function resolveInIncludes(
	doc: ZingDocument,
	name: string
): Promise<boolean> {
	for (const includePath of doc.includes) {
		const includeUri = vscode.Uri.joinPath(doc.uri, "..", includePath);
		try {
			const bytes = await vscode.workspace.fs.readFile(includeUri);
			const text = new TextDecoder().decode(bytes);
			const incDoc = parseZingDocument(text, includeUri);
			const incNames = collectAllDefinedNames(incDoc.ast);
			if (incNames.has(name)) return true;
		} catch {
			// skip unreadable includes
		}
	}
	return false;
}

/* ------------------------------------------------------------------ */
/*  Diagnostic collection helpers                                      */
/* ------------------------------------------------------------------ */

function diagnosticsFromParseErrors(ast: Program): vscode.Diagnostic[] {
	return ast.parseErrors.map(err => {
		const range = new vscode.Range(
			new vscode.Position(err.position.line, err.position.character),
			new vscode.Position(err.position.line, err.position.character + 10)
		);
		return errorDiagnostic(range, err.message);
	});
}

interface DocumentDiagnostics {
	allMemberNames: Map<string, number>;
}

function computeDocumentDiagnostics(doc: ZingDocument): DocumentDiagnostics {
	const allMemberNames = new Map<string, number>();
	for (const m of doc.ast.members) {
		allMemberNames.set(m.name, m.position.line);
	}
	return { allMemberNames };
}

async function diagnosticsFromMember(
	doc: ZingDocument,
	member: Member,
	allMemberNames: Map<string, number>
): Promise<vscode.Diagnostic[]> {
	const diagnostics: vscode.Diagnostic[] = [];
	const { definitions, forLoopVars } = collectMemberDefinitions(member, doc.ast.parameters);
	const forLoopVarNames = new Set(forLoopVars.map(v => v.name));

	for (const stmt of member.body) {
		const { refs, allowedFwdRefs, forLoopOutOfScope } = walkExpressionForDiagnostics(
			stmt.expression,
			definitions,
			forLoopVars,
			false
		);

		for (const ref of refs) {
			if (ref.name === "") continue;
			if (isBuiltIn(ref.name)) continue;

			// Check for-loop variable scope
			if (forLoopVarNames.has(ref.name)) {
				const isOutOfScope = forLoopOutOfScope.some(
					o => o.name === ref.name && o.line === ref.position.line && o.character === ref.position.character
				);
				if (isOutOfScope) {
					diagnostics.push(errorDiagnostic(
						refRange(ref),
						`${ref.name}: iteration variable can only be used inside its repetition`
					));
				}
				continue;
			}

			// Check unresolved (includes top-level + includes)
			const resolved = await resolveIdentifier(doc, ref.name, ref.position.line, definitions);
			if (!resolved) {
				diagnostics.push(errorDiagnostic(
					refRange(ref),
					`${ref.name}: unresolved identifier`
				));
				continue;
			}

			// Check forward reference (member-local + cross-member)
			const defLine = definitions.get(ref.name) ?? allMemberNames.get(ref.name);
			if (defLine != undefined && ref.position.line < defLine && !allowedFwdRefs.has(ref.name)) {
				diagnostics.push(errorDiagnostic(
					refRange(ref),
					`${ref.name}: forward reference`
				));
			}
		}

		// Report for-loop variables used outside their body (from refs not caught above)
		for (const oos of forLoopOutOfScope) {
			const alreadyReported = refs.some(r =>
				r.name === oos.name && r.position.line === oos.line && r.position.character === oos.character
			);
			if (!alreadyReported) {
				const ref: IdentRef = { name: oos.name, position: { line: oos.line, character: oos.character } };
				diagnostics.push(errorDiagnostic(
					refRange(ref),
					`${oos.name}: iteration variable can only be used inside its repetition`
				));
			}
		}
	}

	return diagnostics;
}

async function diagnosticsFromUnresolved(doc: ZingDocument): Promise<vscode.Diagnostic[]> {
	const diagnostics: vscode.Diagnostic[] = [];
	const { allMemberNames } = computeDocumentDiagnostics(doc);
	for (const member of doc.ast.members) {
		diagnostics.push(...await diagnosticsFromMember(doc, member, allMemberNames));
	}
	return diagnostics;
}

async function diagnosticsFromIncludes(ast: Program, uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
	const diagnostics: vscode.Diagnostic[] = [];

	for (const inc of ast.includes) {
		if (inc.path === "") continue;
		const includeUri = vscode.Uri.joinPath(uri, "..", inc.path);
		try {
			await vscode.workspace.fs.readFile(includeUri);
		} catch {
			const pos = inc.stringPosition ?? inc.position;
			const range = new vscode.Range(
				new vscode.Position(pos.line, pos.character),
				new vscode.Position(pos.line, pos.character + inc.path.length + 2)
			);
			diagnostics.push(errorDiagnostic(range, `${inc.path}: file not found`));
		}
	}

	return diagnostics;
}

/* ------------------------------------------------------------------ */
/*  Public: compute diagnostics for a document                         */
/* ------------------------------------------------------------------ */

export async function computeDiagnostics(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
	const doc = parseZingDocument(document.getText(), document.uri);

	const [parseDiagnostics, unresolvedDiagnostics, includeDiagnostics] = await Promise.all([
		Promise.resolve(diagnosticsFromParseErrors(doc.ast)),
		diagnosticsFromUnresolved(doc),
		diagnosticsFromIncludes(doc.ast, document.uri),
	]);

	return [
		...parseDiagnostics,
		...unresolvedDiagnostics,
		...includeDiagnostics,
	];
}

/* ------------------------------------------------------------------ */
/*  Return the DiagnosticCollection so extension.ts can register it    */
/* ------------------------------------------------------------------ */

export function createDiagnosticCollection(): vscode.DiagnosticCollection {
	return vscode.languages.createDiagnosticCollection("zing");
}
