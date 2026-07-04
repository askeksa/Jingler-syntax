# Error Handling — Remaining Gaps

Real Zing compiler vs. VS Code extension diagnostics.

## What's Implemented

The following error categories are fully implemented and match the real compiler:

- **Parse errors** — Parser emits errors for invalid syntax, invalid combinators, empty call args, etc.
- **Forward reference semantics** — Forward refs allowed by default. Flagged only when: (a) outside `cell`/`delay`/`dyndelay` calls, (b) for-loop variables used outside their `for`-expression body. Cross-member forward refs also flagged.
- **Duplicate names** — Detects duplicate members, parameters, inputs, outputs, local variables, MIDI inputs, and built-in shadowing. Diagnostics carry `relatedInformation` pointing to the original definition.
- **Context errors** — All 5 context errors: `'main'` must be global, `'main'` can't have MIDI inputs, instruments can't be global/implicitly note, only global modules can have MIDI inputs.
- **Call context errors** — All 13 call-site validation rules: context compatibility, MIDI prefix rules, MIDI mapping validation (channel range, named input lookup, count mismatch).
- **Argument count errors** — Built-in calls via `BUILT_INS[name].args`, member calls via `inputs.length`. Resolves member signatures through includes.
- **Combinator validation** — Parser validates against `{add, max, min, mul}`.
- **Bytecode emitter errors** — Tuple indexing unsupported, built-in module in repetition body.
- **Include resolution** — Resolves relative to each file's parent directory with circular-include guard.
- **Severity levels** — Parameterized `makeDiagnostic()` with `vscode.DiagnosticSeverity`. `syntaxDiagnostic()` and `errorDiagnostic()` wrappers. Infrastructure ready for `Warning` severity.

## What's Still Missing

### 1. Type Errors (~25+ error types)

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

This is the largest remaining gap. Requires porting full type inference logic from `type_inference.rs`.

### 2. Buffer Init Validation (4 error types)

From `type_inference.rs:696-750`:

- `"Buffer initialization module can't be global"`
- `"Buffer initialization module can only have static inputs"`
- `"Buffer initialization must be a module call"`
- `"Can't initialize a {x} buffer with a {y} number"`

### Summary Table

| Error Category | Real Compiler | Our Extension | Status |
|---|---|---|---|
| Parse errors | 4 types | 1 generic | Minor gap |
| Forward refs | Allowed + 2 CG exceptions | Allowed + 2 exceptions flagged | Done |
| Duplicate names | 3 types | All 5 types + relatedInfo | Done |
| Context errors | 5 types | All 5 detected | Done |
| Type errors | 25+ types | None | **Missing** |
| Call context | 10+ types | All 13 rules | Done |
| Arg count | 1 type | Built-ins + members | Done |
| Buffer init | 4 types | None | **Missing** |
| Combinators | 1 type | Validated | Done |
| Bytecode emitter | 4 types | All 4 detected | Done |
| Include paths | Relative to parent | Relative to parent | Done |
| Severity levels | 5 levels | Parameterized factory | Done |

## Recommended Fixes (Priority Order)

1. **Full type inference** — largest undertaking; requires porting `type_inference.rs` logic
2. **Buffer init validation** — subset of type inference; could be implemented independently
