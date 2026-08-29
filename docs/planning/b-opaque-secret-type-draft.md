# B: opaque secret type for RUNWAY_MCP_API_KEY (DRAFT, do not file until A lands)

Successor to _R1#108. A (co-occurrence check) is the stopgap; this is the durable control.
Overwatch decision 2026-08-28: A then B, B is not an afterthought and does not ride in on #108.

## What it does

Stop letting the secret be a string. Load `RUNWAY_MCP_API_KEY` into a wrapper whose only
useful method routes through `timingSafeTokenMatch`. `token === secret` then fails the type
checker instead of shipping.

## What it is NOT, and this wording is deliberate

**Unwritable by someone following the type checker. NOT unrepresentable.**
TypeScript types are erased at compile time. One `any`, one `as string`, one call from a plain
JS file, one untyped `JSON.parse` result, and the wrapper is a plain object again. Same threat
model as A: it stops ordinary engineering, it does not stop someone casting around it.

A limit read as a guarantee is how a good control becomes a false floor. This ticket has already
generated that failure twice in one night. Do not let a reader upgrade "compile error" to
"impossible" and then stop testing it.

## The load-bearing test, named as such

`matches()` MUST route through `timingSafeTokenMatch`, asserted directly, with a mutation
proving the assertion bites.

**After B lands, that one test is the only thing standing between the fleet and the exact bug
this eight-round ticket exists to kill.** A future reader tidying tests needs to know which one
is load-bearing. That is precisely how WINDOW=200 got where it got.

Why it is load-bearing: A works by finding places the token and the secret co-occur. B's whole
design ensures they co-occur in exactly one place. So B does not strictly strengthen A. It
relocates the risk into the one site A is designed to stop looking at, as its central mechanism.
The first draft of this wrapper had `matches(x) { return this.#v === x }`, a plain-equality token
compare on the one path every caller is forced through. Caught while writing the demo, not while
reasoning about it.

## Egress: measured, not reasoned

Symbol.toPrimitive-only wrapper: **2 of 11 blocked.**
Blocked: `${w}` template, Array.join.
LEAKS CLEARTEXT: JSON.stringify, util.inspect, console.log %o, Object.keys, Object.values,
Object.entries, spread, structuredClone, error payload.

`util.inspect` is what `console.log(obj)` uses. So that wrapper blocks the form a developer
TRIES when checking the guard, and leaves the form a developer actually WRITES.

Mechanism under all nine: `toJSON` and `toPrimitive` are hooks on CONVERSION. The secret was a
normal own enumerable property, so anything that WALKS the object never touches a hook.
**Make it unreachable. Do not decorate the exits.**

Private `#v` field + toJSON + util.inspect.custom: **all 11 safe**, matches() still works.
The private field does the work; the hooks only make output legible.

Reflection sweep, 7 more paths, all safe: Reflect.ownKeys, getOwnPropertySymbols,
getOwnPropertyNames, getOwnPropertyDescriptors, Object.assign target, for..in, Proxy ownKeys trap.

## Residuals, stated so the ticket does not overclaim

1. Type erasure, above.
2. A private `#v` is unreachable to ordinary code including reflection and proxies. It is NOT
   unreachable to a debugger, a heap snapshot, a core dump, or anything reading process memory.
   The secret is still a live string on the heap. Not worth fixing. Say it anyway.
3. Fails closed: `wrapper === "k"` is silently false, so casting around the type denies everyone
   rather than admitting everyone. Evading the control produces an outage, not a bypass.
   **This bills as availability, not authentication. It is still a hole. Not a reason to relax
   anything else.**

## Scope

Touches route code, not just a test file. Behaviour change. Own gate. Two known call sites.
