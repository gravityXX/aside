# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/guidelines.md`**: how the code is designed, written, tested and released. Its rules are numbered; cite them by number.
- **`docs/guidelines.md`, section 10 (Decisions)**: settled choices with their reason. This repo keeps its decisions there instead of in `docs/adr/`.

This is a single-context repo: one set of rules and decisions for the whole codebase.

## Recording terms and decisions

- A new settled decision goes into section 10 of `docs/guidelines.md`, with its reason. Do not create `docs/adr/`.
- There is no `GLOSSARY.md`. Use the names the code and `docs/guidelines.md` already use. Create a `GLOSSARY.md` only after the user agrees to it.

## Flag decision conflicts

If your output contradicts a decision in section 10, surface it explicitly rather than silently overriding:

> _Contradicts decision 10.3 (layers), but worth reopening because…_
