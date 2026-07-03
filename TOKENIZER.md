# Tokenizer Design

## Overview

The tokenizer converts a Zing source file into a flat array of `Token` items in two distinct phases:

1. **`splitLexemes(source: string): SplitResult`** — consumes raw source, produces raw lexeme strings with positions
2. **`matchLexemes(result: SplitResult): Token[]`** — classifies each lexeme's text into a `TokenKind`

Both functions are exported for independent testing. `Tokenizer.tokenize()` is a thin orchestrator:

```ts
public tokenize(): Token[] {
    const result = splitLexemes(this.source);
    return matchLexemes(result);
}
```

## Phase 1 — splitLexemes

### SplitResult

```ts
interface SplitResult {
    lexemes: Lexeme[];
    endLine: number;       // line position after last consumed character
    endCharacter: number;  // character position after last consumed character
}

interface Lexeme {
    text: string;
    line: number;
    character: number;
}
```

### Scan loop

For each position in the source:

1. Skip `\n` (increment `line`, reset `character`)
2. Skip whitespace (` `, `\t`, `\r`)
3. If `#` and `isHashComment()` is true → skip to end of line
4. If `#` and not a comment → emit as single-char lexeme `"#"` (sharp in musical note)
5. Otherwise → lexeme based on current character:
   - `"` → string literal (includes quotes, no escape handling)
   - `[a-zA-Z_]` → identifier (`[a-zA-Z_][a-zA-Z0-9_]*`)
   - `[0-9]` → number (hex `0x...` or decimal with optional fractional part)
   - punctuator → greedy two-char then one-char match
   - unknown → single-char lexeme

### Greedy operator matching

Two-character operators checked before single-character (via `Map` lookup):

| Two-char | Kind |
|---|---|
| `-+` | MinusPlus |
| `->` | Arrow |
| `==` | Eq |
| `!=` | Neq |
| `<=` | LessEq |
| `>=` | GreaterEq |
| `::` | ColonColon |
| `..` | DotDot |

Single-char operators and delimiters fall through to a separate `Map`.

### Number splitting

- **Hex**: `0x` or `0X` prefix, followed by hex digits and optional `.` + fractional hex digits
- **Decimal/integer**: digits, optional `.` + fractional digits
- A trailing `.` without fractional digits is rewound

### Comment handling

`isHashComment()` runs a state machine from the start of the current line up to the `#` position:

- If state is `Note` (just saw `[A-G]`) AND the next character is a digit → `#` is a sharp (not a comment)
- Otherwise → `#` is a comment, skip to end of line

## Phase 2 — matchLexemes

Classifies each lexeme's `text` into a `TokenKind` using data-driven lookups:

1. `true` / `false` → `True` / `False`
2. `KEYWORD_MAP` lookup → keyword kind
3. `OP_MAP` lookup → operator kind
4. `DELIM_MAP` lookup → delimiter kind
5. Starts with `"` → `String`
6. Starts with `0x` / `0X` → `Hex`
7. Contains `.` → `Decimal`
8. All digits → `Decimal`
9. Everything else → `Identifier`

Appends `Eof` token using `endLine` / `endCharacter` from the split result.

## TokenKind

52 variants across 5 categories (no `MidiMapping` — `::` is its own `ColonColon` token):

- **Keywords** (20): `Include`, `Parameter`, `To`, `Global`, `Note`, `Module`, `Function`, `Instrument`, `For`, `Buffer`, `Static`, `Dynamic`, `Mono`, `Stereo`, `Generic`, `NumberKw`, `BoolKw`, `Inf`
- **Operators** (17): `Plus`, `Minus`, `MinusPlus`, `Multiply`, `Divide`, `Assign`, `Eq`, `Neq`, `Less`, `LessEq`, `Greater`, `GreaterEq`, `Or`, `Xor`, `And`, `Question`, `Colon`, `ColonColon`, `Arrow`, `Dot`, `Not`
- **Delimiters** (7): `LParen`, `RParen`, `LSquare`, `RSquare`, `LBrace`, `RBrace`, `Comma`
- **Literals** (6): `Decimal`, `Hex`, `String`, `True`, `False`, `Identifier`
- **Meta** (1): `Eof`

### Token Interface

```ts
interface Token {
    kind: TokenKind;
    text: string;     // original source text (including quotes for strings)
    line: number;     // 0-based line number
    character: number; // 0-based column on that line
}
```

## MIDI mappings

`::` is tokenized as a standalone `ColonColon` token. The parser recognizes MIDI param patterns:

| Pattern | Tokens |
|---|---|
| `kick::` | `Identifier("kick")` `ColonColon` |
| `1::` | `Decimal("1")` `ColonColon` |
| `1{C4}::` | `Decimal("1")` `LBrace` `Identifier("C4")` `RBrace` `ColonColon` |
| `1{C4..G5}::` | `Decimal("1")` `LBrace` `Identifier("C4")` `Dot` `Dot` `Identifier("G5")` `RBrace` `ColonColon` |

Parser helpers `isMidiParamStart()` and `consumeMidiParam()` in `parser.ts` handle the lookahead and reconstruction of `MidiParam.text`.

## Test Coverage

96 tests in `src/test/tokenizer.test.ts`:

- All keywords, booleans, identifiers, numbers (integer, decimal, hex, inf)
- Strings, operators (single, two-char, `-+`, `->`), delimiters
- Comments (hash removal, sharp in notes, trailing sharp, multiple sharps)
- MIDI mappings as separate tokens (channel, range, transpose, sharp notes, named)
- Line/character tracking (basic, after newline, after comment)
- EOF token, integration scenarios
- `splitLexemes` direct tests (lexeme strings, positions, whitespace, comments, sharps, operators)
- `matchLexemes` direct tests (keywords, numbers, operators, delimiters, strings, identifiers, Eof position)
