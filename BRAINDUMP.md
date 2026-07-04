# BRAINDUMP.md — Jingler Syntax Extension

## Project Overview

A VS Code extension for the **Zing** language (`.zing` files) used in Jingler — a real-time audio synthesis domain-specific language.

**Features**: syntax highlighting, document symbols, go-to-definition, hover signatures, semantic tokens, red-squiggly diagnostics.

**Version**: 1.1.3 | **Publisher**: askeksa | **Engine**: VS Code ^1.75.0 | **Tests**: 300 passing, 0 lint errors

## Architecture

### Source Files (all under `src/`)

| File | Lines | Purpose |
|---|---|---|
| `extension.ts` | 38 | Entry point — registers all providers, wires diagnostics to document events |
| `document_symbols.ts` | 192 | Tokenizer + parser orchestration, symbol extraction, `ZingDocument` class |
| `definitions.ts` | 210 | Shared symbol lookup (`symbolAt`, `findSymbolInDocument`, `findSymbolInIncludes`), `DefinitionProvider` |
| `hover.ts` | 307 | `HoverProvider`, `BUILT_INS` table (33 built-ins with signatures, descriptions, arg counts, context, memberKind) |
| `diagnostics.ts` | 859 | `computeDiagnostics`, `DiagnosticCollection`, 8 diagnostic categories, include walker |
| `syntax_highlighting.ts` | 300 | `SemanticTokensProvider`, 14-token legend, AST override map, delta encoding |
| `expression_walk.ts` | 127 | Generic `walkExpression` utility, `ExpressionVisitor` interface, `CELL_DELAY_NAMES` |
| `parser.ts` | 684 | Recursive descent parser, `MidiParserContext` impl, error tracking, recovery, context defaulting |
| `midi_parser.ts` | 149 | Extracted MIDI parsing, `MidiParser` class, `MidiParserContext` interface |
| `tokenizer.ts` | 385 | Two-phase tokenizer (`splitLexemes` + `matchLexemes`), comment/sharp disambiguation |
| `ast.ts` | 231 | All AST node types, `Position`, `ContextKind`, `MemberKind`, etc. |
| `constants.ts` | 3 | `fileEnding` ("zing"), `languageIdentifier` ("zing") |

### Key Interfaces

- `ZingDocument` — wraps parsed AST, symbols, definition ranges, includes, URI
- `SymbolDefinition` — name, nameRange, fullRange, uri (for go-to-definition)
- `HoverTarget` — name, member?, parameter?, statement?, patternItem? (for hover)
- `LookupResult` — member?, parameter? (for cross-file hover/definition)
- `BuiltInInfo` — kind, signature, description, args, context, memberKind (30 entries)
- `ExpressionVisitor` — optional visit methods for all 14 expression kinds
- `MemberSignature` — context, kind, midiInputCount (for call context validation)
- `IdentRef` — name, position, isCall?, midiArgCount? (for diagnostics)
- `ForLoopVar` — name, bodyStart, bodyEnd (for for-loop scope checking)

### Key Constants

- `CELL_DELAY_NAMES = new Set(["cell", "delay", "dyndelay"])` — forward ref exception set
- `BUILT_IN_FUNCTIONS` — Set of 30 built-in function/module names (in syntax_highlighting.ts)
- `VALID_COMBINATORS = new Set(["add", "max", "min", "mul"])` — parser combinator validation
- `NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }` — MIDI note base values

## Diagnostic Pipeline (order matters)

All run in parallel via `Promise.all`, then concatenated in this order:

1. **`diagnosticsFromParseErrors`** — parser errors (missing name, unexpected token, etc.)
2. **`diagnosticsFromDuplicates`** — duplicate members, parameters, inputs, outputs, locals, MIDI inputs, built-in shadowing. Creates `relatedInformation` pointing to original.
3. **`diagnosticsFromContext`** — 5 context errors:
   - `'main'` must be a global module
   - `'main'` can't have MIDI inputs
   - Instruments can't be global
   - Instruments have implicit note context (can't write `note instrument`)
   - Only global modules can have MIDI inputs
4. **`diagnosticsFromArgCount`** — built-in calls via `BUILT_INS[name].args`, member calls via `inputs.length`. Resolves member signatures through includes. Message: `N arguments expected, M given.`
5. **`diagnosticsFromCallContext`** — 13 call-site validation rules:
   - Modules can't be called from functions
   - Global modules can only be called from other global modules
   - Only global modules can be prefixed with MIDI inputs
   - Note modules can only be called from instruments and other note modules
   - Functions can't be prefixed with MIDI inputs
   - Global functions can only be called from global modules/functions
   - Note functions can only be called from instruments, note modules, note functions
   - Instruments must be prefixed with a MIDI input
   - Instruments only take a single MIDI input
   - Instruments can only be called from global modules
   - MIDI channel must be between 1 and 16
   - Named MIDI input must exist on caller
   - MIDI input count must match callee (unless instrument)
6. **`diagnosticsFromUnresolved`** — unresolved identifiers (`Variable not found: 'x'`), forward refs (`'x': Reference to a later variable is only allowed in a cell or delay.`), for-loop scope (`'i': An iteration variable can only be used inside its repetition.`)
7. **`diagnosticsFromBytecodeEmitter`** — 2 checks:
   - Tuple indexing unsupported (`"Not supported yet: tuple indexing."`)
   - Built-in module in repetition body (`"Not supported yet: Built-in module in repetition body."`)
8. **`diagnosticsFromIncludes`** — include path to nonexistent file (`Could not read file 'x.zing'.`)

### Diagnostic Helpers

- `makeDiagnostic(range, message, severity, relatedInformation?)` — central diagnostic factory
- `errorDiagnostic(range, message, relatedInformation?)` — wraps `makeDiagnostic` with `Error` severity
- `syntaxDiagnostic(range, message)` — convenience wrapper for parse errors
- `checkDuplicate(diagnostics, seen, name, position, message, document?)` — eliminates repetitive get/insert/test pattern; creates `relatedInformation` when document provided
- `walkIncludes<T>(includes, baseUri, extract, acc, visited)` — generic include walker for reusable traversal
- `collectMemberDefinitions(member, parameters)` — collects all defined names within a member + for-loop variable info
- `collectMemberSignatures` / `collectMemberInputsFromIncludes` — resolves member signatures across include files

## Include Resolution

- Resolves relative to each file's parent directory: `vscode.Uri.joinPath(baseUri, "..", includePath")`
- Recursive walking with `visited` Set for circular-include guard
- Generic `walkIncludes<T>` utility in `diagnostics.ts` for reusable include traversal
- Separate `findSymbolInIncludes` in `definitions.ts` for hover/definition lookup (returns `LookupResult`)
- `findSymbolInDocument` in `definitions.ts` checks local member scope first, then includes

## Hover Resolution Order

1. **Built-ins** (`BUILT_INS` table) — returns `**kind** signature` + `\n\n` + description
2. **Current document AST** (`findAstNode`):
   - Current-line assignment LHS (priority) — `**variable** name — assigned: expr`
   - Member inputs/outputs — `**parameter** name: type`
   - Other-line assignments — `**variable** name — assigned: expr`
   - Top-level members — `**kind** name(inputs) → outputs`
   - Top-level parameters — `**parameter** name min to max = default`
3. **Includes** (`findSymbolInIncludes` from `definitions.ts`) — returns member or parameter from included files

No backticks on names. Uniform spacing (no space before/after parens).

## Expression AST (14 kinds)

`walkExpression` in `expression_walk.ts` is the single source of truth for AST traversal. Used by diagnostics, syntax_highlighting, and `collectFwdRefs`.

| Kind | Fields | Notes |
|---|---|---|
| `NumberLiteral` | value: string | Decimal, hex, inf |
| `BoolLiteral` | value: boolean | true/false |
| `Variable` | name: string | Identifier reference |
| `Unary` | operator: "-" \| "!", operand | Negation, logical not |
| `Binary` | operator, left, right | All binary operators |
| `Conditional` | condition, thenBranch, elseBranch | Ternary |
| `Call` | midiArgs, name, arguments | Method calls flattened: `result.process(1)` → `Call(name: "process", args: [Variable("result"), NumberLiteral("1")])` |
| `Tuple` | elements | `(a, b, c)` |
| `Merge` | left, right | `[left, right]` stereo merge |
| `TupleIndex` | target, index: number | `tuple.0` |
| `BufferIndex` | target, index: Expression | `buffer[expr]` |
| `BufferLiteral` | elements | `{ a, b, c }` |
| `For` | variable, count, combinator, combinatorPosition, body | Repetition |
| `BufferInit` | length, width?, body | Buffer initialization |
| `Expand` | expression, width | Injected by type inference (not parsed) |

## Tokenizer

Two-phase: `splitLexemes` (raw lexeme strings with positions) → `matchLexemes` (classify to `TokenKind`).

- Emits `Comment` tokens; `filterTokens()` removes comments and EOF for parser consumption
- Comment/sharp disambiguation: `#` after a note letter (A-G) followed by a digit is a sharp, otherwise it's a comment
- 52 `TokenKind` variants: 20 keywords, 17 operators, 7 delimiters, 6 literals, 1 meta
- Greedy operator matching: two-char operators (`-+`, `->`, `::`, `..`, etc.) checked before single-char
- Hex numbers: `0x` prefix, optional `.fractional` part
- Trailing `.` without fractional digits is rewound

## Parser

Recursive descent with precedence climbing. Lenient: records `parseErrors`, recovers via `skipToNextMemberStart()`.

- Tracks `endLine`/`endCharacter` on all positions
- Context defaults: `module` → `Global`, `instrument` → `Note`, `function` → `Universal`
- MIDI parsing extracted to `src/midi_parser.ts` via `MidiParserContext` interface
- `TYPE_TOKENS` lookup table replaces 8 `if/else if` branches in `parseExplicitType`
- `skipBracketBlock(open, close)` deduplicated bracket-skipping helper
- `parsePostfixChain(expr)` extracted from `parseUnary` for tuple index, method call, buffer index
- `parseFor` uses `tryPeekAhead` to distinguish buffer init from regular for-loop
- Combinator validation: parser validates against `{add, max, min, mul}`, emits parse error

## Key Design Decisions

- **Inline markdown** with bold for hover content (no fenced code blocks, no backticks on names)
- **Unicode `→`** for return arrows in hover
- **Built-in hover** separates signature and description with `\n\n` (markdown paragraph break)
- **AST flattens method calls**: `result.process(1)` → `Call(name: "process", args: [Variable("result"), NumberLiteral("1")])`
- **Forward refs allowed by default**: only flagged when outside `cell`/`delay`/`dyndelay` calls, for-loop scope, or cross-member
- **`DiagnosticCollection`** approach (not `DocumentDiagnosticProvider`) — wired to `onDidOpen`, `onDidChange`, `onDidClose` document events
- **Delta encoding** uses `prevChar` to prevent range gaps in semantic tokens
- **Provider objects** exported as named `let` bindings
- **`checkDuplicate`** helper eliminates repetitive get/insert/test pattern; creates `relatedInformation` when document provided
- **Output names** assigned in body are excluded from duplicate detection (expected Zing pattern: output declared in pattern, assigned in body)
- **`explicitContext`** flag on `Member` distinguishes user-written context keywords from defaults
- **Unresolved messages** distinguish `"Function or module not found"` vs `"Instrument or global module not found"` based on `midiArgCount` on call expressions
- **`BUILT_INS`** now includes `context` and `memberKind` fields for call context validation
- **`IdentRef`** carries optional `isCall` and `midiArgCount` fields for unresolved message disambiguation

## Built-in Functions (27)

All Universal context unless noted. Descriptions are distilled from source code behavior:

All Universal context unless noted:

| Name | Args | Signature | Context |
|---|---|---|---|
| `atan2` | 2 | `(mono, mono) → mono` | Universal |
| `ceil` | 1 | `(generic) → generic` | Universal |
| `cos` | 1 | `(mono) → mono` | Universal |
| `exp2` | 1 | `(mono) → mono` | Universal |
| `floor` | 1 | `(generic) → generic` | Universal |
| `gate` | 0 | `() → mono bool` | **Note** |
| `gmdls` | 2 | `(mono, mono) → mono` | Universal |
| `index` | 1 | `(generic buffer) → mono` | Universal |
| `key` | 0 | `() → mono` | **Note** |
| `left` | 1 | `(stereo) → mono` | Universal |
| `length` | 1 | `(generic buffer) → mono` | Universal |
| `log2` | 1 | `(mono) → mono` | Universal |
| `max` | 2 | `(generic, generic) → generic` | Universal |
| `min` | 2 | `(generic, generic) → generic` | Universal |
| `random` | 2 | `(mono, mono) → mono` | Universal |
| `right` | 1 | `(stereo) → mono` | Universal |
| `round` | 1 | `(generic) → generic` | Universal |
| `samplerate` | 0 | `() → mono` | Universal |
| `sin` | 1 | `(mono) → mono` | Universal |
| `sincos` | 1 | `(mono) → (mono, mono)` | Universal |
| `sqrt` | 1 | `(generic) → generic` | Universal |
| `tan` | 1 | `(mono) → mono` | Universal |
| `trunc` | 1 | `(generic) → generic` | Universal |
| `velocity` | 0 | `() → mono` | **Note** |
| `center` | 1 | `(stereo) → mono` | Universal |
| `swap` | 1 | `(stereo) → stereo` | Universal |
| `pow` | 2 | `(mono, mono) → mono` | Universal |

## Built-in Modules (3)

All Universal context. Descriptions distilled from source code behavior:

| Name | Args | Signature |
|---|---|---|
| `cell` | 2 | `(dynamic generic typeless, static generic typeless) → dynamic generic typeless` |
| `delay` | 2 | `(dynamic generic typeless, static mono number) → dynamic generic typeless` |
| `dyndelay` | 3 | `(dynamic generic typeless, dynamic mono number, static mono number) → dynamic generic typeless` |

## Semantic Tokens (14 types)

Custom Zing types mapped to TextMate scopes via `package.json` `semanticTokenScopes`:

| Token Type | TextMate Scope | Used For |
|---|---|---|
| `zingToplevel` | `storage.type.zing.toplevel` | module, function, instrument, include, parameter, buffer |
| `zingToplevelModifier` | `storage.modifier.zing.toplevel` | global, note |
| `zingScope` | `entity.name.type.zing.scope` | static, dynamic |
| `zingWidth` | `entity.name.type.zing.width` | mono, stereo, generic |
| `zingType` | `entity.name.type.zing.type` | number, bool |
| `zingControl` | `keyword.control.zing` | for, to |
| `supportFunction` | `support.function` | built-in function names |
| `comment` | (built-in) | comments |
| `string` | (built-in) | string literals |
| `number` | (built-in) | numbers, booleans, inf |
| `operator` | (built-in) | operators, punctuation, delimiters |
| `variable` | (built-in) | identifiers (non-built-in) |
| `function` | (built-in) | function call names, member names |
| `parameter` | (built-in) | parameter names, MIDI params |

Modifiers: `declaration` (for declarations), `static` (for static scope keyword)

## Testing

300 Mocha tests via `@vscode/test-electron` (runs inside VS Code extension host). `CancellationTokenSource` required in tests due to VS Code API version constraints.

| File | Lines | Tests | Coverage |
|---|---|---|---|
| `diagnostics.test.ts` | 977 | 297 | Parser errors, unresolved/resolved variables, forward refs, built-ins, ForExpr, merge/conditional/buffer/tuple/unary expressions, method calls, include resolution, severity, ranges, duplicate detection, context errors, argument count errors, call context errors (13 rules), bytecode emitter errors, relatedInformation |
| `hover.test.ts` | 623 | 42+ | Members, parameters, locals, built-ins (all 30), expressions (all kinds), edge cases, included-file hover |
| `parser.test.ts` | 421 | ~40 | Includes, parameters, members, type annotations, expressions, MIDI mappings, parse errors, lenient recovery |
| `tokenizer.test.ts` | 483 | 96 | Keywords, booleans, identifiers, numbers, strings, operators, delimiters, comments, sharps, MIDI mappings, positions, split/match phases |
| `syntax_highlighting.test.ts` | 117 | ~15 | Tokenizer defaults, semantic tokens, legend |
| `document_symbols.test.ts` | 75 | 10 | Symbol extraction, include directives, comment skipping |

`test-workspace/` contains 4 strictly valid `.zing` files for integration testing:
- `main.zing` (67 lines) — includes all 3 others, exercises all expression types
- `core.zing` (44 lines) — modules, functions, buffer literals, conditionals, tuple returns
- `instruments.zing` (23 lines) — instruments with MIDI params, includes core.zing
- `utils.zing` (32 lines) — functions, modules with MIDI params, includes core.zing

## Remaining Gaps (vs. Real Compiler)

### Missing: Type Errors (~25+ types)

From `type_inference.rs`:
- `"Inputs and outputs must specify explicit width"`
- `"Module outputs can't be static"` / `"Function inputs or outputs can't be marked static or dynamic"` / `"Instrument outputs can't be static"`
- `"Static instrument inputs can't come after dynamic inputs"`
- `"Instruments must have exactly one output"`
- `"'main' can't have any inputs"` / `"'main' must have a single output of type stereo number"`
- `"Expression of type X can't be assigned to 'Y'Z"` — type mismatch on assignment
- `"Can't have both static and dynamic in the same pattern"`
- `"Variables in functions can't be marked static or dynamic"`
- `"No assignment to output '{name}'"` — output not assigned in body
- `"Mismatching number of values: X in pattern, Y in expression"` — tuple arity mismatch
- `"Single value expected for {title}"` — wrong arity
- `"Can't pass a dynamic value into a static input"` — scope mismatch
- `"Can't pass a {width} value into a {width} input"` — width mismatch
- `"Can't mix stereo and generic values for generic inputs"`
- `"Can't mix different types for typeless inputs"`
- `"Index {x} outside range of tuple of length {y}"` — tuple index out of bounds
- `"Can't expand a mono buffer to {width}"`
- `"Conditionals on buffers must have mono conditions"`
- `"Values inside a tuple can't be auto-expanded from mono"`

Largest remaining gap. Requires porting full type inference logic from `type_inference.rs`.

### Missing: Buffer Init Validation (4 types)

From `type_inference.rs:696-750`:
- `"Buffer initialization module can't be global"`
- `"Buffer initialization module can only have static inputs"`
- `"Buffer initialization must be a module call"`
- `"Can't initialize a {x} buffer with a {y} number"`

### Minor Gap: Parse Error Messages

Parser emits 1 generic message format; real compiler has 4 specific formats.

## Build & Publish

```
just init          # npm install + global vsce/ovsx
npm run compile    # TypeScript → out/
npm run lint       # ESLint on src/**/*.ts
npm test           # run Mocha tests in VS Code extension host
just package       # build .vsix
just publish <ovsx_token>  # publish to VS Code Marketplace + Open VSX
```

No CI workflows. TypeScript strict mode, commonjs target, es2020.

## Real Compiler References

- `../Jingler/crates/zing/src/names.rs` — name resolution, duplicate detection (lines 62-147, 152-175)
- `../Jingler/crates/zing/src/type_inference.rs` — type checking, call context validation (lines 520-631), buffer init (696-750)
- `../Jingler/crates/zing/src/code_generator.rs` — bytecode emitter errors (tuple indexing at 1227, built-in in repetition at 1099)
- `../Jingler/crates/zing/src/compiler.rs` — include resolution, context validation
- `../Jingler/crates/zing/src/zing.lalrpop` — grammar source
- `../Jingler/crates/zing/src/ast.rs` — real AST definition
- `../Jingler/crates/zing/src/builtin.rs` — built-in definitions with context info
