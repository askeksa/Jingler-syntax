# Zing Language Reference

## Overview

Zing is a domain-specific language for real-time audio synthesis, used in Jingler. A Zing program defines modules, functions, and instruments that process audio signals with static and dynamic execution phases.

## Lexical Structure

### Comments

`#` starts a comment to end of line. Inside musical note names (e.g., `C#4`, `D#3`), `#` is a sharp symbol, not a comment. The tokenizer distinguishes this context.

### Identifiers

`[a-zA-Z_][a-zA-Z0-9_]*`

### Literals

| Kind | Example |
|---|---|
| Number (float) | `0.5`, `44100`, `3.14` |
| Boolean | `true`, `false` |
| String | `"path/to/file.zing"` |
| MIDI range | `1{C4..G5 / C3}` |

### Operators

| Symbol | Meaning |
|---|---|
| `+` | Add |
| `-` | Subtract |
| `-+` | AddSub (stereo add/subtract) |
| `*` | Multiply |
| `/` | Divide |
| `&` | Logical AND |
| `\|` | Logical OR |
| `^` | Logical XOR |
| `==` `!=` `<` `<=` `>` `>=` | Comparison |
| `-` (unary) | Negate |
| `!` (unary) | Logical NOT |

### Punctuation

`(` `)` `->` `::` `=` `,` `?` `:` `[` `]` `{` `}` `.`

## Types

A type has three optional components: **scope**, **width**, and **value type**.

### Scope

| Keyword | Meaning |
|---|---|
| `static` | Evaluated once at initialization |
| `dynamic` | Evaluated every audio frame |

In modules, variables default to `static`. Functions have no scope distinction.

### Width

| Keyword | Meaning |
|---|---|
| `mono` | Single-channel audio |
| `stereo` | Two-channel audio |
| `generic` | Width inferred from context |

Mono values auto-expand to stereo or generic where required. Buffers cannot be auto-expanded.

### Value Type

| Keyword | Meaning |
|---|---|
| `number` | Floating-point audio sample |
| `bool` | Boolean |
| `buffer` | Audio buffer (sample array) |
| `typeless` | Placeholder — resolved by inference |

### Type Syntax

```
: static mono number
: dynamic stereo buffer
: mono bool
: generic number
```

Components can appear in any order. Missing components are inferred.

## Program Structure

```
Program → Include* Parameter* Member*
```

### Include

```
include "path/to/other.zing"
```

Resolves relative to the including file. Circular includes are detected.

### Parameter

```
parameter name min to max = default
```

Global runtime parameters with a range and optional default value.

### Member

```
[context] kind [midi::]* name (inputs) -> outputs
    body
```

**Context** (optional): `global`, `note`, `universal` (default)

**Kind**: `module`, `function`, `instrument`

**MIDI inputs** (modules only): `channel{noteRange / transpose}::` or `name::`

**Inputs/Outputs**: comma-separated `name: type` declarations. Width is mandatory. Scope and value type are optional (defaults: `dynamic stereo number` for modules, `stereo number` for functions).

### Member Rules

| Rule | Detail |
|---|---|
| `main` | Must be a global module with no inputs and one `stereo number` output |
| Instruments | Implicit `note` context. Must have exactly one output (`mono` or `stereo` number). Static inputs must precede dynamic inputs. |
| Global modules | Can have MIDI inputs. Can only call other global modules, global functions, or instruments. |
| Note modules | Can only be called from instruments or other note modules. |
| Functions | Cannot be marked `static`/`dynamic`. Cannot call modules. |

## Formal Grammar

BNF-style grammar derived from the LALRPOP source (`zing.lalrpop`). Terminals are in backticks, non-terminals use CamelCase.

### Program

```
Program → Include* Parameter* Member*
```

### Include & String

```
Include → `include` String
String → <double-quoted string literal, e.g. "path/to/file.zing">
```

### Parameter

```
Parameter → `parameter` Id SignedNum `to` SignedNum ParameterDefault
ParameterDefault → /* empty */ | `=` SignedNum
SignedNum → Num | `-` Num
```

### Member

```
Member → Context MemberKind MidiParam* Id Pattern `->` Pattern Statement*
Context → /* empty (Universal) */ | `global` | `note`
MemberKind → `module` | `function` | `instrument`
MidiParam → Id `::`
```

### Pattern

```
Pattern → PatternItems          (parenthesized)
Pattern → PatternItemsNoParen   (unparenthesized, for statement LHS)

PatternItems → /* empty */ | `(` Comma<PatternItem> `)`
PatternItemsNoParen → Comma<PatternItem>
PatternItem → Id | Id ExplicitType
ExplicitType → `:` Scope? Width? ValueType?
Scope → `static` | `dynamic`
Width → `mono` | `stereo` | `generic`
ValueType → `number` | `bool` | `buffer`
```

### Comma helper

```
Comma<T> → (T `,`)* T?
```

### Statement

```
Statement → PatternNoParen `=` Expression
```

### Expression (full precedence hierarchy)

```
Expression → OrExpression
           | OrExpression `?` Expression `:` Expression        (Conditional)
           | `for` Id `to` Expression Id Expression             (For — repetition)
           | `for` Expression Width? `buffer` Expression        (BufferInit)

OrExpression    → BinOpLevel<OrOp, XorExpression>
XorExpression   → BinOpLevel<XorOp, AndExpression>
AndExpression   → BinOpLevel<AndOp, CompareExpression>
CompareExpression → BinOpLevel<CompareOp, AdditiveExpression>
AdditiveExpression → BinOpLevel<AdditiveOp, MultiplicativeExpression>
MultiplicativeExpression → BinOpLevel<MultiplicativeOp, UnaryExpression>

OrOp       → `|`
XorOp      → `^`
AndOp      → `&`
CompareOp  → `==` | `!=` | `<` | `<=` | `>` | `>=`
AdditiveOp → `+` | `-` | `-+`
MultiplicativeOp → `*` | `/`

BinOpLevel<Op, Next> → BinOpLevel<Op, Next> BinOp<Op> NextLevel
                      | NextLevel
```

### Unary & Primary expressions

```
UnaryExpression → UnOp<UnaryOp> PrimaryExpression
                | UnaryExpression `.` Id ParenthesizedExpressions?   (method-style call)
                | UnaryExpression `.` Uint                            (tuple index)
                | PrimaryExpression

UnaryOp → `-` | `!`

PrimaryExpression → Num                                        (Number)
                  | Bool                                       (Bool)
                  | Id                                         (Variable)
                  | MidiArg* Id ParenthesizedExpressions        (Call)
                  | ParenthesizedExpressions                    (Tuple)
                  | `[` Expression `,` Expression `]`           (Merge)
                  | `{` Comma<Expression> `}`                   (BufferLiteral)
                  | PrimaryExpression `[` Expression `]`        (BufferIndex)
```

### Parenthesized expressions

```
ParenthesizedExpressions → `(` Comma<Expression> `)`
```

### MIDI arguments (on calls and member declarations)

```
MidiArg → Uint `::`                                    (all notes on channel)
        | Uint `{` MidiNoteRangeTranspose `}` `::`     (channel with range)
        | Id `::`                                      (named MIDI input passthrough)

MidiNoteRangeTranspose → MidiNoteRange
                       | MidiNoteRange `/` MidiNote    (with transpose target)

MidiNoteRange → MidiNote                              (single note)
              | `..` MidiNote                         (up to note)
              | MidiNote `..`                         (from note)
              | MidiNote `..` MidiNote                (range)

MidiNote → <musical note, e.g. C4, D#3, G5>
```

### Literals

```
Num → Uint | DecimalNum | HexadecimalNum | `inf`
Uint → <unsigned integer: 0 or [1-9][0-9]*>
DecimalNum → <integer part> `.` <fractional part>
HexadecimalNum → `0x` <hex digits> (`. ` <hex fraction>)?

Bool → `false` | `true`
```

### Identifier

```
Id → <[_a-zA-Z][_a-zA-Z0-9]*>
```

### Repetition combinators

The `for ... to ... combinator ...` expression requires `combinator` to be one of:

| Combinator | Neutral value | Operation |
|---|---|---|
| `add` | 0 | Sum |
| `mul` | 1 | Product |
| `max` | -∞ | Maximum |
| `min` | +∞ | Minimum |

## Statements

Only one kind exists — assignment:

```
pattern = expression
```

A pattern is a comma-separated list of named variables with optional type annotations. The expression on the right must produce the same number of values.

## Expressions

### Precedence (lowest to highest)

| Level | Syntax |
|---|---|
| Conditional | `cond ? then : otherwise` |
| OR | `\|` |
| XOR | `^` |
| AND | `&` |
| Compare | `==` `!=` `<` `<=` `>` `>=` |
| Additive | `+` `-` `-+` |
| Multiplicative | `*` `/` |
| Unary | `-` `!` |
| Primary | literals, calls, tuples, etc. |

### Expression Variants

**Number literal**: `0.5`, `44100` — type `mono number`

**Boolean literal**: `true`, `false` — type `mono bool`

**Variable**: `x` — type from declaration or inference

**Unary**: `-x`, `!x`

**Binary**: `a + b`, `a & b`, etc.

**Conditional**: `cond ? then : otherwise` — type matches branches

**Call**: `[midi::]* name(args)` — type from callee signature

**Tuple**: `(a, b, c)` — produces multiple values

**Merge**: `[left, right]` — combines two mono values into stereo

**Tuple index**: `tuple.0`, `tuple.1` — extracts by position

**Buffer index**: `buffer[expr]` — reads a sample from a buffer

**Repetition (For)**: `for i to count combinator body`
- `count`: static mono number
- `combinator`: `add`, `max`, `min`, `mul`
- `body`: evaluated `count` times, combined with the combinator

**Buffer init**: `for length [width] buffer body`
- Creates a buffer of `length` samples by calling a module `body`
- `body` must be a module call with all static inputs
- `width` is optional, inferred from `body` output

**Buffer literal**: `{ a, b, c }` — creates a buffer from expressions

**Expand**: `[expr]` — explicitly expands mono to wider width

## Built-in Functions

| Name | Signature | Description |
|---|---|---|
| `atan2` | `(mono, mono) → mono` | |
| `ceil` | `(generic) → generic` | |
| `cos` | `(mono) → mono` | |
| `exp2` | `(mono) → mono` | |
| `floor` | `(generic) → generic` | |
| `gate` | `() → mono bool` | Note gate status (note context) |
| `gmdls` | `(mono, mono) → mono` | GM DLS sample mapping |
| `index` | `(generic buffer) → mono` | Buffer indexing |
| `key` | `() → mono` | MIDI note number (note context) |
| `left` | `(stereo) → mono` | Left channel |
| `length` | `(generic buffer) → mono` | Buffer length |
| `log2` | `(mono) → mono` | |
| `max` | `(generic, generic) → generic` | |
| `min` | `(generic, generic) → generic` | |
| `random` | `(mono, mono) → mono` | Random in range |
| `right` | `(stereo) → mono` | Right channel |
| `round` | `(generic) → generic` | |
| `samplerate` | `() → mono` | Sample rate |
| `sin` | `(mono) → mono` | |
| `sincos` | `(mono) → (mono, mono)` | Sine and cosine |
| `sqrt` | `(generic) → generic` | |
| `tan` | `(mono) → mono` | |
| `trunc` | `(generic) → generic` | |
| `velocity` | `() → mono` | Note velocity (note context) |
| `center` | `(stereo) → mono` | Center channel (precompiled) |
| `swap` | `(stereo) → stereo` | Swap channels (precompiled) |
| `pow` | `(mono, mono) → mono` | Power (precompiled) |

## Built-in Modules

| Name | Signature | Description |
|---|---|---|
| `cell` | `(dynamic typeless, static typeless) → dynamic typeless` | Stateful value with update |
| `delay` | `(dynamic typeless, static mono number) → dynamic typeless` | Fixed delay line |
| `dyndelay` | `(dynamic typeless, dynamic mono number, static mono number) → dynamic typeless` | Variable delay |

## MIDI Mappings

Used to route MIDI input to global modules and instruments.

**Value mapping**: `channel{start..end / transpose}`
- `channel`: 1–16
- `start`/`end`: MIDI note names (e.g., `C4`, `G5`, `C#3`)
- `transpose`: optional transpose target

**Named mapping**: `name::` — references a MIDI input declared on the parent module.

## Type Inference

- Module I/O defaults to `dynamic stereo number` (inputs can be `static`)
- Function I/O defaults to `stereo number` (no scope)
- Instrument I/O defaults to `dynamic stereo number`
- Unscoped variables default to `static` in modules
- Mono values auto-expand to required width
- Generic width resolves to the widest argument (`mono` < `stereo` < `generic`)
- Typeless resolves to the concrete type of arguments

## Execution Model

Modules have two execution phases:
1. **Static**: Runs once at initialization. Handles static-scope values, buffer allocation, cell initialization.
2. **Dynamic**: Runs every audio frame. Handles dynamic-scope audio processing.

Functions execute in a single phase (no static/dynamic split).

Instruments have an implicit accumulator input for summing outputs across MIDI notes. An autokill mechanism stops notes when their output falls below a threshold.
