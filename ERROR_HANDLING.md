# Error Handling — Discrepancy Report

Real Zing compiler vs. VS Code extension diagnostics.

## 1. Forward Reference Semantics (Major)

The real compiler does **NOT** do line-aware resolution. `Names::find` (`names.rs:62-147`) collects all names into a single HashMap per member — all inputs, outputs, body assignments, and for-loop variables are inserted eagerly, regardless of order. Then `type_inference.rs:466-471` checks `lookup_variable` and reports `"Variable not found: '{name}'"` only if the name is truly absent.

However, the **bytecode emitter** (`code_generator.rs:1057-1065`) adds two additional checks on forward references:
- `"Reference to a later variable is only allowed in a cell or delay."` — forward reference to a Node variable used outside a `cell`/`delay` call
- `"An iteration variable can only be used inside its repetition."` — for-loop variable referenced outside its `for`-expression body

**Our implementation** uses line-aware resolution (`stmt.position.line < beforeLine`), which is **stricter** than the real compiler. We flag all forward references as errors, but the real compiler allows them (with the two exceptions above).

## 2. Missing: Duplicate Definition Errors

From `names.rs:152-165`:
- `"Duplicate definition of '{name}'"` — duplicate member, variable, or parameter
- `"Duplicate MIDI input '{name}'"` — duplicate MIDI input name
- `"The {kind} '{name}' has the same name as a built-in {kind}"` — shadowing built-ins

We have **none** of these.

## 3. Missing: Context Errors

From `compiler.rs:371-407`:
- `"No 'main' module"` — required entry point
- `"'main' must be a global module"` — wrong context
- `"'main' can't have MIDI inputs"` — invalid config
- `"Instruments can't be global"` / `"Instruments have implicit note context"` — wrong context
- `"Only global modules can have MIDI inputs"` — MIDI on non-global

We have **none** of these.

## 4. Missing: Type Errors (~30+ error types)

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

We have **none** of these.

## 5. Missing: Call Context Errors

From `type_inference.rs:520-631`:
- `"Modules can't be called from functions"`
- `"Global modules can only be called from other global modules"`
- `"Note modules can only be called from instruments and other note modules"`
- `"Functions can't be prefixed with MIDI inputs"`
- `"Global functions can only be called from global modules and other global functions"`
- `"Note functions can only be called from instruments, note modules and other note functions"`
- `"Instruments must be prefixed with a MIDI input and '::'"`
- `"Instruments only take a single MIDI input"`
- `"Instruments can only be called from global modules"`
- `"MIDI channel must be between 1 and 16"`
- `"Incorrect number of MIDI inputs: {x} given, {y} expected"`
- `"MIDI input not found: '{name}'"` — named MIDI input reference

We check for **unresolved call targets** but not for any of the context/validation errors.

## 6. Missing: Argument Count Errors

From `type_inference.rs:772-805`:
- `"{x} arguments expected, {y} given"` — wrong number of args for a call

We don't check this.

## 7. Missing: Buffer Init Validation

From `type_inference.rs:696-750`:
- `"Buffer initialization module can't be global"`
- `"Buffer initialization module can only have static inputs"`
- `"Buffer initialization must be a module call"`
- `"Can't initialize a {x} buffer with a {y} number"`

We don't check any of these.

## 8. Missing: Combinator Validation

From `type_inference.rs:680-683`:
- `"Permitted repetition combinators are '{x}', '{y}', ..."` — invalid combinator name in for-expression

We don't check this.

## 9. Missing: Bytecode Emitter Errors

From `code_generator.rs` — these are only caught at code generation time, after parsing and type inference:
- `"Not supported yet: tuple indexing."` — `TupleIndex` expression used (`code_generator.rs:1227-1228`)
- `"Not supported yet: Built-in module in repetition body."` — `cell`/`delay`/`dyndelay` called inside a `for`-expression body (`code_generator.rs:1098-1100`)
- `"Reference to a later variable is only allowed in a cell or delay."` — forward reference to a Node variable used outside a `cell`/`delay` call (`code_generator.rs:1057-1059`)
- `"An iteration variable can only be used inside its repetition."` — for-loop variable referenced outside its `for`-expression body (`code_generator.rs:1062-1065`)

We have **none** of these. The forward-reference checks (#3 and #4) are particularly important because they refine the forward reference semantics described in section 1.

## 10. Severity Levels

The real compiler has 5 severity levels: `SyntaxError`, `Error`, `InternalError`, `Warning`, `Context`. We only use `vscode.DiagnosticSeverity.Error` for everything. The real compiler uses `Warning` for non-fatal issues and `Context` for "previously defined here" cross-references.

## 11. Include Resolution

The real compiler resolves includes relative to the **including file's parent directory** (`compiler.rs:300-305`). We resolve relative to the **main file's directory** (`vscode.Uri.joinPath(doc.uri, "..", includePath)`). This is wrong for nested include chains.

## Summary Table

| Error Category | Real Compiler | Our Extension | Gap |
|---|---|---|---|
| Parse errors | 4 types | 1 generic | Minor |
| Forward refs | Allowed (with 2 CG exceptions) | Allowed + 2 exceptions flagged | **Fixed** |
| Duplicate names | 3 types | All 5 types | **Fixed** |
| Context errors | 5 types | None | Missing |
| Type errors | 25+ types | None | Missing |
| Call context | 10+ types | None | Missing |
| Arg count | 1 type | None | Missing |
| Buffer init | 4 types | None | Missing |
| Combinators | 1 type | None | Missing |
| Bytecode emitter | 4 types | None | Missing |
| Include paths | Relative to parent | Relative to main | **Bug** |
| Severity levels | 5 levels | 1 level (Error) | Missing |

## Recommended Fixes (Priority Order)

1. ~~**Refine forward ref checking** — DONE (2026-07-04). Forward refs now allowed by default. Flagged only when: (a) outside `cell`/`delay`/`dyndelay` calls, (b) for-loop variables used outside their `for`-expression body. Cross-member forward refs also flagged.~~
2. ~~**Fix include path resolution** — DONE (2026-07-04). Includes now resolve relative to each file's parent directory. Recursive include chains are handled correctly with circular-include guard.~~
3. ~~**Add duplicate name detection** — DONE (2026-07-04). Detects: duplicate members, parameters, inputs, outputs, local variables, MIDI inputs, and built-in shadowing for members/parameters. Output names assigned in body are excluded (expected pattern).~~
4. **Add combinator validation** — check `add`, `max`, `min`, `mul` only
5. **Add context errors** — main module, instrument, and note/global context validation
6. **Add argument count errors** — compare call args to known signatures
7. **Add call context errors** — module/function/instrument call-site validation
8. **Add bytecode emitter errors** — tuple indexing unsupported, built-in module in repetition body
9. **Add severity levels** — map `SyntaxError`/`Error`/`Warning` to VS Code severities
10. **Full type inference** — largest undertaking; requires porting `type_inference.rs` logic
