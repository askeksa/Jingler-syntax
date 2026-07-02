# Tokenizer Design

## Overview

The tokenizer converts a Zing source file into a flat array of `Token` items in a single pass. Comments are handled inline during scanning (no separate pre-processing step).

## Token Type

### TokenKind (Discriminated Union)

52 variants across 6 categories:

- **Keywords** (20): `Include`, `Parameter`, `To`, `Global`, `Note`, `Module`, `Function`, `Instrument`, `For`, `Buffer`, `Static`, `Dynamic`, `Mono`, `Stereo`, `Generic`, `NumberKw`, `BoolKw`, `Inf`
- **Operators** (17): `Plus`, `Minus`, `MinusPlus`, `Multiply`, `Divide`, `Assign`, `Eq`, `Neq`, `Less`, `LessEq`, `Greater`, `GreaterEq`, `Or`, `Xor`, `And`, `Question`, `Colon`, `ColonColon`, `Arrow`, `Dot`, `Not`
- **Delimiters** (7): `LParen`, `RParen`, `LSquare`, `RSquare`, `LBrace`, `RBrace`, `Comma`
- **Literals** (7): `Decimal`, `Hex`, `String`, `True`, `False`, `Identifier`
- **MIDI** (1): `MidiMapping`
- **Meta** (1): `Eof`

Keywords are recognized by looking up identifier text in a `Map<string, KeywordKind>`. `true`/`false` are handled separately as `True`/`False`.

### Token Interface

```ts
interface Token {
  kind: TokenKind;
  text: string;     // original source text (including quotes for strings)
  line: number;     // 0-based line number
  character: number; // 0-based column on that line
}
```

Line/character are tracked during the scan loop, matching VS Code's `Position` semantics.

## Tokenizer Class

```ts
class Tokenizer {
  constructor(source: string)
  tokenize(): Token[]
}
```

Returns a `Token[]` that always ends with an `Eof` token.

### Main Scan Loop

For each position in the source:

1. Skip `\n` (increment `line`, reset `character`)
2. Skip whitespace (` `, `\t`, `\r`)
3. If `#` and `isHashComment()` is true → skip to end of line
4. Otherwise → tokenize based on current character:
   - `"` → string literal
   - `[a-zA-Z_]` → try MIDI mapping identifier, then identifier/keyword
   - `[0-9]` → try MIDI mapping number, then number
   - anything else → punctuator (greedy multi-char match)

### Comment Handling

`isHashComment()` runs a state machine from the start of the current line up to the `#` position:

- If state is `Note` (just saw `[A-G]`) AND the next character is a digit → `#` is a sharp (not a comment)
- Otherwise → `#` is a comment, skip to end of line

This handles:
- `C#4` → sharp preserved (state is `Note`, next char is digit)
- `C#x` → comment (state is `Note`, next char is not digit)
- `G#` at end of line → comment (state is `Note`, no following digit)
- `# comment` → comment (state is `Initial`)

### Greedy Operator Matching

Two-character operators checked before single-character:

| Two-char | Kind |
|---|---|
| `-+` | MinusPlus |
| `->` | Arrow |
| `==` | Eq |
| `!=` | Neq |
| `<=` | LessEq |
| `>=` | GreaterEq |
| `::` | ColonColon |

`-+` and `->` are checked first (as special cases), then a lookup for `==`, `!=`, `<=`, `>=`, `::`. Single-char operators fall through to a `switch`.

### Number Parsing

- **Decimal**: digits, optional `.` and fractional digits (e.g., `42`, `3.14`)
- **Hex**: `0x` prefix, hex digits, optional `.` and fractional hex digits (e.g., `0x1A.F`)
- **`inf`**: keyword token

A trailing `.` without fractional digits is rewound.

### MIDI Mapping Tokenization

MIDI mappings are consumed as a single token:

| Form | Example |
|---|---|
| `<uint>::` | `1::` |
| `<uint>{<note>}::` | `1{C4}::` |
| `<uint>{<note>..<note>}::` | `1{C4..G5}::` |
| `<uint>{<range> / <note>}::` | `1{C4..G5 / C3}::` |
| `<id>::` | `kick::` |

Lookahead approach with rewind on failure:

1. **`tryMidiMappingNumber`**: reads digits, checks for `::` or `{`. On failure, rewinds.
2. **`tryMidiMappingRange`**: parses note names (`[A-G][-#][0-9]`), optional `..` range, optional `/` transpose, then `}::`. Whitespace is skipped inside.
3. **`tryMidiMappingIdentifier`**: reads identifier, checks for `::`. Only matches if the character after `::` is NOT an identifier start character (prevents consuming `Foo::Bar` as a MIDI mapping — the `::` is tokenized separately).

## Integration with VS Code

`parseZingDocument` in `document_symbols.ts` imports `Tokenizer` and uses `token.kind` comparisons instead of text matching. `vscode.Position` is constructed from `token.line` and `token.character`.

## Test Coverage

48 tests in `src/test/tokenizer.test.ts`:

- All keywords, booleans, identifiers, numbers (integer, decimal, hex, inf)
- Strings, operators (single, two-char, `-+`, `->`), delimiters
- Comments (hash removal, sharp in notes, trailing sharp, multiple sharps)
- MIDI mappings (channel, range, transpose, sharp notes, named, non-MIDI fallback)
- Line/character tracking (basic, after newline, after comment)
- EOF token, integration scenarios
