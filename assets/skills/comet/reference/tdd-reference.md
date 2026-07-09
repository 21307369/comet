# TDD Reference

Canonical path: `comet/reference/tdd-reference.md`

This reference supplements the Superpowers `test-driven-development` skill with enhanced practices from mattpocock/tdd. Consult it when writing tests during the build phase.

## Characteristics of Good Tests

Tests verify behavior through public interfaces, not implementation details. Good tests read like specifications and survive refactors because they don't care about internal structure.

**Good tests:**
- Test behavior users/callers care about
- Use public API only
- Describe WHAT, not HOW
- One logical assertion per test

## Seams — Where Tests Go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, confirm the seams under test. You can't test everything — agreeing the seams up front ensures testing effort lands on critical paths and complex logic.

## Anti-Patterns

Avoid these common mistakes:

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel. The tell: the test breaks when you refactor but behavior hasn't changed.

- **Tautological** — the assertion recomputes the expected value the way the code does, so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth.

- **Horizontal slicing** — writing all tests first, then all implementation. Bulk tests verify imagined behavior. Work in **vertical slices** instead: one test → one implementation → repeat.

## Rules of the Loop

- **Red before green.** Write the failing test first, then only enough code to pass it.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage, not the red → green implementation cycle.

## When to Mock

Mock at **system boundaries** only:
- External APIs (payment, email, etc.)
- Databases (sometimes — prefer test DB)
- Time/randomness
- File system (sometimes)

Don't mock:
- Your own classes/modules
- Internal collaborators
- Anything you control

**Design for mockability:** Use dependency injection — pass external dependencies in rather than creating them internally. Prefer SDK-style interfaces over generic fetchers.
