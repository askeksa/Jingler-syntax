# Jingler Syntax — AGENTS.md

## What this is

A VS Code extension providing syntax highlighting, document symbols, go-to-definition, hover signatures, semantic highlighting, and red-squiggly diagnostics for the **Zing** language (`.zing` files) used in Jingler.

## Quick start

```
just init          # npm install + global vsce/ovsx
npm run compile    # TypeScript → out/
npm run watch      # watch mode
npm run lint       # ESLint on src/**/*.ts
npm test           # run Mocha tests in VS Code extension host
just package       # build .vsix
```

No CI workflows.

## Reference documents

- **`BRAINDUMP.md`** — Essential project information: architecture, key interfaces, design decisions, diagnostic pipeline, built-ins, semantic tokens, testing, remaining gaps. **Read first.**
- **`ZING.md`** — Zing language reference: lexical structure, types, grammar, expressions, built-ins, execution model. Read when working on tokenizer, parser, grammar, or anything language-specific.
- **`TOKENIZER.md`** — Tokenizer design: `TokenKind` variants, `Token` interface, scan loop, comment/sharp disambiguation, greedy operator matching, MIDI mapping tokenization. Read when modifying the tokenizer.
- **`ERROR_HANDLING.md`** — Remaining gaps between real compiler and extension diagnostics. Read when working on error handling.

## TypeScript guidelines

- **Strict mode**: `tsc` runs with `"strict": true` — all code must satisfy strict null checks, no implicit `any`, and definite assignment checks.
- **Target / module**: Compiles to `commonjs` targeting `es2020`. Do not use ES2021+ features or ESM syntax.
- **Root dir**: `"rootDir": "src"` — all source files must live under `src/`. The compiler will error if files are placed elsewhere.
- **Output**: Compiled JS lands in `out/` (gitignored). Never edit files in `out/` directly; always modify `src/` and recompile.
- **Imports**: Use relative paths without `.js` or `.ts` extensions (e.g. `"./document_symbols"`). The `vscode` package is imported as `import * as vscode from 'vscode'`.
- **Typing**: Prefer explicit return types on exported functions. Use `vscode.*` types from `@types/vscode` rather than rolling your own. Avoid `any` — use `unknown` or specific types.
- **Variables**: Prefer `let` and `const` over `var`. The codebase still contains some `var` declarations from earlier versions; new code should use `let`/`const`.
- **Null / undefined**: With strict mode enabled, always guard nullable values. Use `!= undefined` or `!== undefined` checks before accessing properties on optional types.
- **Provider exports**: Provider objects are exported as named `let` bindings (e.g. `export let documentSymbolProvider`). Follow this pattern for new providers.
- **Constants**: Language-identifying values live in `src/constants.ts` and should be imported rather than hardcoded.
- **Formatting**: All files use tabs (size 4) for indentation.
- **Verification**: After changes, run `npm run compile` then `npm run lint` then `npm test` to confirm the code builds, passes lint, and tests pass.

## Working on diagnostics

- Diagnostic pipeline order: parseErrors → duplicates → context → argCount → callContext → unresolved → bytecodeEmitter → includes
- All run in parallel via `Promise.all`, then concatenated in order
- `makeDiagnostic(range, message, severity, relatedInformation?)` centralizes diagnostic creation
- `checkDuplicate` helper eliminates repetitive get/insert/test pattern; creates `relatedInformation` when document provided
- Generic `walkIncludes<T>` utility for reusable include traversal
- Include resolution: relative to each file's parent directory, recursive with circular-include guard
- See `BRAINDUMP.md` for full diagnostic pipeline details, helper functions, and error categories

## Working on hover

- Resolution order: built-ins → current document AST → includes
- Inline markdown with bold (no fenced code blocks, no backticks on names)
- Unicode `→` for return arrows
- Built-in hover: `**kind** signature` + `\n\n` + description (paragraph break)
- No space before/after parens in any hover popup
- AST flattens method calls: `result.process(1)` → `Call(name: "process", args: [Variable("result"), NumberLiteral("1")])`
- See `BRAINDUMP.md` for `BUILT_INS` table, hover target resolution, and markdown builders

## Working on the parser

- Lenient: records `parseErrors`, recovers via `skipToNextMemberStart()`
- Context defaults: `module` → `Global`, `instrument` → `Note`, `function` → `Universal`
- MIDI parsing extracted to `src/midi_parser.ts` via `MidiParserContext` interface
- Tracks `endLine`/`endCharacter` on all positions
- See `BRAINDUMP.md` for parser internals, `TYPE_TOKENS`, `skipBracketBlock`, `parsePostfixChain`

## Working on expression walking

- `walkExpression` in `expression_walk.ts` is the single source of truth for AST traversal
- `ExpressionVisitor` interface with optional visit methods for all 14 expression kinds
- Used by diagnostics, syntax_highlighting, and `collectFwdRefs`
- `CELL_DELAY_NAMES = new Set(["cell", "delay", "dyndelay"])` for forward ref exception checking
- See `BRAINDUMP.md` for full expression AST table with all 14 kinds and their fields

## Remaining gaps (vs. real compiler)

See `ERROR_HANDLING.md` for full details. In brief:
1. **Type errors** (~25+ types) — largest undertaking; requires porting `type_inference.rs` logic
2. **Buffer init validation** (4 types) — subset of type inference; could be implemented independently

## Real compiler references

- `../Jingler/crates/zing/src/names.rs` — name resolution, duplicate detection
- `../Jingler/crates/zing/src/type_inference.rs` — type checking, call context validation (lines 520-631)
- `../Jingler/crates/zing/src/code_generator.rs` — bytecode emitter errors
- `../Jingler/crates/zing/src/compiler.rs` — include resolution, context validation
- `../Jingler/crates/zing/src/zing.lalrpop` — grammar source
- `../Jingler/crates/zing/src/ast.rs` — real AST definition
- `../Jingler/crates/zing/src/builtin.rs` — built-in definitions with context info
