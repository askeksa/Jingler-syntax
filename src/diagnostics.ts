import * as vscode from 'vscode';
import { parseZingDocument, ZingDocument } from "./document_symbols";
import {
	ContextKind,
	Expression,
	Include,
	Member,
	MemberKind,
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
	isCall?: boolean;
	midiArgCount?: number;
}

function refRange(ref: IdentRef): vscode.Range {
	return new vscode.Range(
		new vscode.Position(ref.position.line, ref.position.character),
		new vscode.Position(ref.position.line, ref.position.character + ref.name.length)
	);
}

function makeDiagnostic(
	range: vscode.Range,
	message: string,
	severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error,
	relatedInformation?: vscode.DiagnosticRelatedInformation[]
): vscode.Diagnostic {
	const diag = new vscode.Diagnostic(range, message, severity);
	if (relatedInformation) {
		diag.relatedInformation = relatedInformation;
	}
	return diag;
}

function errorDiagnostic(
	range: vscode.Range,
	message: string,
	relatedInformation?: vscode.DiagnosticRelatedInformation[]
): vscode.Diagnostic {
	return makeDiagnostic(range, message, vscode.DiagnosticSeverity.Error, relatedInformation);
}

function syntaxDiagnostic(
	range: vscode.Range,
	message: string
): vscode.Diagnostic {
	return makeDiagnostic(range, message, vscode.DiagnosticSeverity.Error);
}

/* ------------------------------------------------------------------ */
/*  Generic include walker                                             */
/*  Reads include files recursively, invokes `extract` per parsed doc. */
/* ------------------------------------------------------------------ */

type IncludeExtract<T> = (incDoc: ZingDocument, acc: T) => void;

async function walkIncludes<T>(
	includes: Include[],
	baseUri: vscode.Uri,
	extract: IncludeExtract<T>,
	acc: T,
	visited: Set<string> = new Set()
): Promise<void> {
	for (const inc of includes) {
		if (inc.path === "") continue;
		const includeUri = vscode.Uri.joinPath(baseUri, "..", inc.path);
		try {
			const bytes = await vscode.workspace.fs.readFile(includeUri);
			const text = new TextDecoder().decode(bytes);
			const incDoc = parseZingDocument(text, includeUri);
			extract(incDoc, acc);
			const incUri = includeUri.toString();
			if (!visited.has(incUri)) {
				visited.add(incUri);
				await walkIncludes(incDoc.ast.includes, includeUri, extract, acc, visited);
			}
		} catch {
			// skip unreadable includes
		}
	}
}

/* ------------------------------------------------------------------ */
/*  Resolve an identifier – returns true if it can be resolved        */
/* ------------------------------------------------------------------ */

function isBuiltIn(name: string): boolean {
	return name in BUILT_INS;
}

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

async function resolveIdentifier(
	doc: ZingDocument,
	name: string,
	memberDefinitions: Map<string, number> | null
	): Promise<boolean> {
		if (isBuiltIn(name)) return true;
		if (memberDefinitions != null && memberDefinitions.has(name)) return true;
		if (collectAllDefinedNames(doc.ast).has(name)) return true;

		// Walk includes looking for the name
		const found = { found: false };
		await walkIncludes(doc.ast.includes, doc.uri, (incDoc, acc) => {
			if (acc.found) return;
			if (collectAllDefinedNames(incDoc.ast).has(name)) {
				acc.found = true;
			}
		}, found);
		return found.found;
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
				refs.push({ name: e.name, position: e.position, isCall: true, midiArgCount: e.midiArgs.length });
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
/*  Diagnostic collection helpers                                      */
/* ------------------------------------------------------------------ */

function diagnosticsFromParseErrors(ast: Program): vscode.Diagnostic[] {
	return ast.parseErrors.map(err => {
		const range = new vscode.Range(
			new vscode.Position(err.position.line, err.position.character),
			new vscode.Position(err.position.line, err.position.character + 10)
		);
		return syntaxDiagnostic(range, err.message);
	});
}

async function diagnosticsFromMember(
	doc: ZingDocument,
	member: Member,
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
						`'${ref.name}': An iteration variable can only be used inside its repetition.`
					));
				}
				continue;
			}

			// Check unresolved (includes top-level + includes)
			const resolved = await resolveIdentifier(doc, ref.name, definitions);
			if (!resolved) {
				const hasMidi = ref.isCall && (ref.midiArgCount ?? 0) > 0;
				const msg = hasMidi
					? `Instrument or global module not found: '${ref.name}'.`
					: ref.isCall
						? `Function or module not found: '${ref.name}'.`
						: `Variable not found: '${ref.name}'.`;
				diagnostics.push(errorDiagnostic(refRange(ref), msg));
				continue;
			}

			// Check forward reference — only for local variables within this member.
			// Member calls can reference each other in any order (real compiler: lookup_member has no fwd check).
			const localDefLine = definitions.get(ref.name);
			if (localDefLine != undefined && ref.position.line < localDefLine && !allowedFwdRefs.has(ref.name)) {
				diagnostics.push(errorDiagnostic(
					refRange(ref),
					`'${ref.name}': Reference to a later variable is only allowed in a cell or delay.`
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
					`'${oos.name}': An iteration variable can only be used inside its repetition.`
				));
			}
		}
	}

	return diagnostics;
}

async function diagnosticsFromUnresolved(doc: ZingDocument): Promise<vscode.Diagnostic[]> {
	const diagnostics: vscode.Diagnostic[] = [];
	for (const member of doc.ast.members) {
		diagnostics.push(...await diagnosticsFromMember(doc, member));
	}
	return diagnostics;
}

async function diagnosticsFromIncludes(ast: Program, uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
	const diagnostics: vscode.Diagnostic[] = [];
	const visited = new Set<string>();
	for (const inc of ast.includes) {
		if (inc.path === "") continue;
		const includeUri = vscode.Uri.joinPath(uri, "..", inc.path);
		try {
			const bytes = await vscode.workspace.fs.readFile(includeUri);
			const text = new TextDecoder().decode(bytes);
			const incDoc = parseZingDocument(text, includeUri);
			const incUri = includeUri.toString();
			if (!visited.has(incUri)) {
				visited.add(incUri);
				await diagnosticsFromIncludes(incDoc.ast, includeUri);
			}
		} catch {
			const pos = inc.stringPosition ?? inc.position;
			const range = new vscode.Range(
				new vscode.Position(pos.line, pos.character),
				new vscode.Position(pos.line, pos.character + inc.path.length + 2)
			);
			diagnostics.push(errorDiagnostic(range, `Could not read file '${inc.path}'.`));
		}
	}
	return diagnostics;
}

/* ------------------------------------------------------------------ */
/*  Argument count errors                                              */
/* ------------------------------------------------------------------ */

async function diagnosticsFromArgCount(ast: Program, uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
	const memberInputs = new Map<string, number>();
	for (const m of ast.members) {
		memberInputs.set(m.name, m.inputs.length);
	}
	await walkIncludes(ast.includes, uri, (incDoc, map) => {
		for (const m of incDoc.ast.members) {
			if (!map.has(m.name)) {
				map.set(m.name, m.inputs.length);
			}
		}
	}, memberInputs);

	const diagnostics: vscode.Diagnostic[] = [];

	for (const member of ast.members) {
		for (const stmt of member.body) {
			walkExpression(stmt.expression, {
				visitCall: expr => {
					let expectedArgs: number | null = null;
					if (expr.name in BUILT_INS) {
						expectedArgs = BUILT_INS[expr.name].args;
					} else if (memberInputs.has(expr.name)) {
						expectedArgs = memberInputs.get(expr.name)!;
					}
					if (expectedArgs != null && expr.arguments.length !== expectedArgs) {
						diagnostics.push(errorDiagnostic(
							refRange({ name: expr.name, position: expr.position }),
							`${expectedArgs} arguments expected, ${expr.arguments.length} given.`
						));
					}
				}
			});
		}
	}

	return diagnostics;
}

/* ------------------------------------------------------------------ */
/*  Call context errors                                                 */
/* ------------------------------------------------------------------ */

interface MemberSignature {
	context: ContextKind;
	kind: MemberKind;
	midiInputCount: number;
}

function memberToSignature(m: Member): MemberSignature {
	return {
		context: m.context,
		kind: m.kind,
		midiInputCount: m.midiParams.length,
	};
}

function lookupSignature(
	name: string,
	memberSigs: Map<string, MemberSignature>
): MemberSignature | null {
	if (memberSigs.has(name)) return memberSigs.get(name)!;
	const bi = BUILT_INS[name];
	if (bi) return { context: bi.context, kind: bi.memberKind, midiInputCount: 0 };
	return null;
}

function pushCtxError(diagnostics: vscode.Diagnostic[], ref: IdentRef, message: string): void {
	diagnostics.push(errorDiagnostic(refRange(ref), message));
}

async function diagnosticsFromCallContext(ast: Program, uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
	const memberSigs = new Map<string, MemberSignature>();
	for (const m of ast.members) {
		memberSigs.set(m.name, memberToSignature(m));
	}
	await walkIncludes(ast.includes, uri, (incDoc, map) => {
		for (const m of incDoc.ast.members) {
			if (!map.has(m.name)) {
				map.set(m.name, memberToSignature(m));
			}
		}
	}, memberSigs);

	const diagnostics: vscode.Diagnostic[] = [];

	for (const member of ast.members) {
		const callerContext = member.context;
		const callerKind = member.kind;
		const callerMidiNames = new Set(member.midiParams.map(mp => mp.name));

		for (const stmt of member.body) {
			walkExpression(stmt.expression, {
				visitCall: expr => {
					const callee = lookupSignature(expr.name, memberSigs);
					if (!callee) return;

					const midiLen = expr.midiArgs.length;
					const midiLoc = midiLen > 0 ? expr.midiArgs[0].position : expr.position;

					// --- Context compatibility ---
					if (callee.kind === "Module" && callerKind === "Function") {
						pushCtxError(diagnostics, { name: expr.name, position: expr.position },
							"Modules can't be called from functions.");
						return;
					}

					if (callee.kind === "Module" && callee.context === "Global" && callerContext !== "Global") {
						pushCtxError(diagnostics, { name: expr.name, position: expr.position },
							"Global modules can only be called from other global modules.");
						return;
					}

					if (callee.kind === "Module" && midiLen > 0 && callee.context !== "Global") {
						pushCtxError(diagnostics, { name: expr.name, position: midiLoc },
							"Only global modules can be prefixed with MIDI inputs.");
						return;
					}

					if (callee.kind === "Module" && callee.context === "Note" && callerContext !== "Note") {
						pushCtxError(diagnostics, { name: expr.name, position: expr.position },
							"Note modules can only be called from instruments and other note modules.");
						return;
					}

					if (callee.kind === "Function" && midiLen > 0) {
						pushCtxError(diagnostics, { name: expr.name, position: midiLoc },
							"Functions can't be prefixed with MIDI inputs.");
						return;
					}

					if (callee.kind === "Function" && callee.context === "Global" && callerContext !== "Global") {
						pushCtxError(diagnostics, { name: expr.name, position: expr.position },
							"Global functions can only be called from global modules and other global functions.");
						return;
					}

					if (callee.kind === "Function" && callee.context === "Note" && callerContext !== "Note") {
						pushCtxError(diagnostics, { name: expr.name, position: expr.position },
							"Note functions can only be called from instruments, note modules and other note functions.");
						return;
					}

					// --- Instrument rules ---
					if (callee.kind === "Instrument" && midiLen === 0) {
						pushCtxError(diagnostics, { name: expr.name, position: midiLoc },
							"Instruments must be prefixed with a MIDI input and '::'.");
						return;
					}

					if (callee.kind === "Instrument" && midiLen > 1) {
						pushCtxError(diagnostics, { name: expr.name, position: midiLoc },
							"Instruments only take a single MIDI input.");
						return;
					}

					if (callee.kind === "Instrument" && (callerKind !== "Module" || callerContext !== "Global")) {
						pushCtxError(diagnostics, { name: expr.name, position: expr.position },
							"Instruments can only be called from global modules.");
						return;
					}

					// --- MIDI mapping validation ---
					const shouldValidateMidi = callee.kind === "Instrument" || midiLen === callee.midiInputCount;
					if (shouldValidateMidi) {
						for (const mm of expr.midiArgs) {
							if (mm.kind === "Value" && (mm.channel < 1 || mm.channel > 16)) {
								pushCtxError(diagnostics, { name: expr.name, position: midiLoc },
									"MIDI channel must be between 1 and 16.");
								return;
							}
							if (mm.kind === "Named" && !callerMidiNames.has(mm.name)) {
								pushCtxError(diagnostics, { name: mm.name, position: mm.position },
									`MIDI input not found: '${mm.name}'.`);
								return;
							}
						}
					} else if (callee.kind !== "Instrument" && midiLen !== callee.midiInputCount) {
						pushCtxError(diagnostics, { name: expr.name, position: expr.position },
							`Incorrect number of MIDI inputs: ${midiLen} given, ${callee.midiInputCount} expected`);
						return;
					}
				}
			});
		}
	}

	return diagnostics;
}

/* ------------------------------------------------------------------ */
/*  Context errors                                                     */
/* ------------------------------------------------------------------ */

function diagnosticsFromContext(ast: Program): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];

	for (const member of ast.members) {
		if (member.name === "main") {
			if (member.context === "Global" && member.kind === "Module") {
				if (member.midiParams.length > 0) {
					const mp = member.midiParams[0];
					diagnostics.push(errorDiagnostic(
						refRange({ name: mp.name, position: mp.position }),
						"'main' can't have MIDI inputs."
					));
				}
			} else {
				diagnostics.push(errorDiagnostic(
					refRange({ name: member.name, position: member.namePosition }),
					"'main' must be a global module."
				));
			}
		}

		if (member.kind === "Instrument") {
			if (member.context === "Global") {
				diagnostics.push(errorDiagnostic(
					refRange({ name: member.name, position: member.namePosition }),
					"Instruments can't be global."
				));
			} else if (member.explicitContext && member.context === "Note") {
				diagnostics.push(errorDiagnostic(
					refRange({ name: member.name, position: member.namePosition }),
					"Instruments have implicit note context."
				));
			}
		}

		if (member.kind !== "Instrument" && member.context !== "Global" && member.midiParams.length > 0) {
			const mp = member.midiParams[0];
			diagnostics.push(errorDiagnostic(
				refRange({ name: mp.name, position: mp.position }),
				"Only global modules can have MIDI inputs."
			));
		}
	}

	return diagnostics;
}

/* ------------------------------------------------------------------ */
/*  Duplicate name detection                                           */
/* ------------------------------------------------------------------ */

function checkDuplicate(
	diagnostics: vscode.Diagnostic[],
	seen: Map<string, IdentRef>,
	name: string,
	position: { line: number; character: number },
	message: string,
	document?: vscode.TextDocument
): void {
	const existing = seen.get(name);
	if (existing) {
		let related: vscode.DiagnosticRelatedInformation[] | undefined;
		if (document) {
			const loc = new vscode.Location(document.uri, refRange(existing));
			related = [new vscode.DiagnosticRelatedInformation(loc, `Previously defined here`)];
		}
		diagnostics.push(errorDiagnostic(refRange({ name, position }), message, related));
	} else {
		seen.set(name, { name, position });
	}
}

function memberKindLabel(kind: MemberKind): string {
	switch (kind) {
		case "Module": return "module";
		case "Function": return "function";
		case "Instrument": return "instrument";
	}
}

function diagnosticsFromDuplicates(ast: Program, document: vscode.TextDocument): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];
	const memberNames = new Map<string, IdentRef>();
	const paramNames = new Map<string, IdentRef>();

	for (const param of ast.parameters) {
		checkDuplicate(diagnostics, paramNames, param.name, param.namePosition,
			`Duplicate definition of '${param.name}'.`, document);
		if (isBuiltIn(param.name)) {
			diagnostics.push(errorDiagnostic(
				refRange({ name: param.name, position: param.namePosition }),
				`The parameter '${param.name}' has the same name as a built-in function.`
			));
		}
	}

	for (const member of ast.members) {
		checkDuplicate(diagnostics, memberNames, member.name, member.namePosition,
			`Duplicate definition of '${member.name}'.`, document);
		if (isBuiltIn(member.name)) {
			const kind = memberKindLabel(member.kind);
			diagnostics.push(errorDiagnostic(
				refRange({ name: member.name, position: member.namePosition }),
				`The ${kind} '${member.name}' has the same name as a built-in ${kind}.`
			));
		}
	}

	for (const member of ast.members) {
		diagnostics.push(...diagnosticsFromMemberDuplicates(member, document));
	}

	return diagnostics;
}

function diagnosticsFromMemberDuplicates(member: Member, document: vscode.TextDocument): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];
	const names = new Map<string, IdentRef>();
	const midiNames = new Map<string, IdentRef>();

	for (const midi of member.midiParams) {
		if (midi.name === "_") continue;
		checkDuplicate(diagnostics, midiNames, midi.name, midi.position,
			`Duplicate MIDI input '${midi.name}'.`, document);
	}

	const inputNames = new Set<string>();
	for (const item of member.inputs) {
		inputNames.add(item.name);
		checkDuplicate(diagnostics, names, item.name, item.position,
			`Duplicate definition of '${item.name}'.`, document);
	}

	// Outputs are NOT inserted into the variables map by the real compiler (names.rs).
	// They can only duplicate each other. An output sharing a name with an input
	// is a valid passthrough pattern (e.g. `function lowp(x) -> x`).
	const outputNames = new Map<string, IdentRef>();
	for (const item of member.outputs) {
		if (inputNames.has(item.name)) continue;
		checkDuplicate(diagnostics, outputNames, item.name, item.position,
			`Duplicate definition of '${item.name}'.`, document);
	}

	for (const stmt of member.body) {
		for (const item of stmt.pattern) {
			checkDuplicate(diagnostics, names, item.name, item.position,
				`Duplicate definition of '${item.name}'.`, document);
		}
	}

	return diagnostics;
}

/* ------------------------------------------------------------------ */
/*  Bytecode emitter errors                                            */
/*  Tuple indexing unsupported + built-in module in repetition body    */
/* ------------------------------------------------------------------ */

function diagnosticsFromBytecodeEmitter(ast: Program): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];

	for (const member of ast.members) {
		for (const stmt of member.body) {
			walkExpression(stmt.expression, {
				visitTupleIndex: expr => {
					const start = expr.target.position;
					const endChar = expr.position.character + String(expr.index).length;
					diagnostics.push(errorDiagnostic(
						new vscode.Range(
							new vscode.Position(start.line, start.character),
							new vscode.Position(expr.position.line, endChar)
						),
						"Not supported yet: tuple indexing."
					));
				},
				visitFor: expr => {
					walkExpression(expr.body, {
						visitCall: call => {
							if (call.name in BUILT_INS && BUILT_INS[call.name].memberKind === "Module") {
								diagnostics.push(errorDiagnostic(
									refRange({ name: call.name, position: call.position }),
									"Not supported yet: Built-in module in repetition body."
								));
							}
						}
					});
				},
			});
		}
	}

	return diagnostics;
}

/* ------------------------------------------------------------------ */
/*  Public: compute diagnostics for a document                         */
/* ------------------------------------------------------------------ */

export async function computeDiagnostics(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
	const doc = parseZingDocument(document.getText(), document.uri);

	const [parseDiagnostics, duplicateDiagnostics, contextDiagnostics, argCountDiagnostics, callContextDiagnostics, unresolvedDiagnostics, bytecodeDiagnostics, includeDiagnostics] = await Promise.all([
		Promise.resolve(diagnosticsFromParseErrors(doc.ast)),
		Promise.resolve(diagnosticsFromDuplicates(doc.ast, document)),
		Promise.resolve(diagnosticsFromContext(doc.ast)),
		diagnosticsFromArgCount(doc.ast, document.uri),
		diagnosticsFromCallContext(doc.ast, document.uri),
		diagnosticsFromUnresolved(doc),
		Promise.resolve(diagnosticsFromBytecodeEmitter(doc.ast)),
		diagnosticsFromIncludes(doc.ast, document.uri),
	]);

	return [
		...parseDiagnostics,
		...duplicateDiagnostics,
		...contextDiagnostics,
		...argCountDiagnostics,
		...callContextDiagnostics,
		...unresolvedDiagnostics,
		...bytecodeDiagnostics,
		...includeDiagnostics,
	];
}

/* ------------------------------------------------------------------ */
/*  Return the DiagnosticCollection so extension.ts can register it    */
/* ------------------------------------------------------------------ */

export function createDiagnosticCollection(): vscode.DiagnosticCollection {
	return vscode.languages.createDiagnosticCollection("zing");
}
