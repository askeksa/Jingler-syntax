# Jingler Syntax — AGENTS.md

## What this is

A VS Code extension providing syntax highlighting, document symbols, and Go-to-Definition for the **Zing** language (`.zing` files) used in Jingler.

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

## Structure

| Path | Purpose |
|---|---|
| `src/extension.ts` | Entry point — registers symbol provider, definition provider, and block-comment override |
| `src/document_symbols.ts` | Tokenizer + parser for `module`/`function`/`instrument` declarations and `include` directives |
| `src/definitions.ts` | Go-to-Definition provider; resolves symbols through `include` chains by reading files from disk |
| `src/constants.ts` | Language identifier (`zing`) and file extension |
| `src/test/` | Mocha tests — uses `@vscode/test-electron` to run inside VS Code extension host |
| `syntaxes/zing.tmLanguage.json` | TextMate grammar — syntax highlighting rules |
| `language-configuration.json` | Language config (brackets, comments, etc.) |
| `out/` | Compiled JavaScript (gitignored, produced by `tsc`) |

## Key details

- **Activation**: `onLanguage:zing` — extension only loads when a `.zing` file is opened.
- **Build**: `tsc -p ./` outputs to `out/`. The `main` field in package.json points to `./out/extension.js`.
- **Publishing**: `just publish <ovsx_token>` publishes to both VS Code Marketplace and Open VSX Registry. Requires `vsce` and `ovsx` installed globally (`just init` does this).
- **Block comment override**: The extension maps `editor.action.blockComment` to `editor.action.commentLine` because Zing has no block comment syntax.

## TypeScript guidelines

- **Strict mode**: `tsc` runs with `"strict": true` — all code must satisfy strict null checks, no implicit `any`, and definite assignment checks.
- **Target / module**: Compiles to `commonjs` targeting `es2020`. Do not use ES2021+ features or ESM syntax (`import/export` at the top level is fine for TypeScript, but the output is CommonJS).
- **Root dir**: `"rootDir": "src"` — all source files must live under `src/`. The compiler will error if files are placed elsewhere.
- **Output**: Compiled JS lands in `out/` (gitignored). Never edit files in `out/` directly; always modify `src/` and recompile.
- **Imports**: Use relative paths without `.js` or `.ts` extensions (e.g. `"./document_symbols"`). The `vscode` package is imported as `import * as vscode from 'vscode'`.
- **Typing**: Prefer explicit return types on exported functions. Use `vscode.*` types from `@types/vscode` rather than rolling your own. Avoid `any` — use `unknown` or specific types.
- **Variables**: Prefer `let` and `const` over `var`. The codebase still contains some `var` declarations from earlier versions; new code should use `let`/`const`.
- **Null / undefined**: With strict mode enabled, always guard nullable values. Use `!= undefined` or `!== undefined` checks before accessing properties on optional types.
- **Provider exports**: Provider objects are exported as named `let` bindings (e.g. `export let documentSymbolProvider`). Follow this pattern for new providers.
- **Constants**: Language-identifying values live in `src/constants.ts` and should be imported rather than hardcoded.
- **Formatting**: All files use tabs (size 4) for indentation.
- **Verification**: After changes, run `npm run compile` then `npm run lint` then `npm test` to confirm the code builds, passes lint, and tests pass. Tests run inside the VS Code extension host via `@vscode/test-electron`.
