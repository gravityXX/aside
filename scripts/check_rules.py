#!/usr/bin/env python3
"""Check that the rule numbers in docs/guidelines.md hold together.

The code, the tests and the docs cite rules by number, such as (2.9) or (4.20 to 4.22), and
nothing else keeps those honest: inserting a rule renumbers the ones after it and every comment
that cited one silently points somewhere else. This checks both directions.

1. The numbering in guidelines.md itself: sections run 1, 2, 3, ... and the rules inside each
   section run 1, 2, 3, ... with no number used twice and none skipped.
2. Every rule a file cites exists.

It runs from the repository root and prints what it checked:

    python3 scripts/check_rules.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

GUIDELINES = Path("docs/guidelines.md")

# Where a rule may be cited. Markdown and TypeScript only: the pictures script cites none.
SEARCHED = ("hooks", "tests", "types", "docs", "scripts")
SEARCHED_FILES = ("CONTRIBUTING.md", "README.md", ".claude/CLAUDE.md")
SUFFIXES = {".ts", ".tsx", ".md", ".py"}

# A section heading, "## 4. TypeScript", and a rule, "7. Inputs are `readonly`." at the start
# of a line. A rule number is only ever written flush left in this file.
SECTION = re.compile(r"^## (\d+)\. ")
RULE = re.compile(r"^(\d+)\. ")

# A group of citations: "(2.9)", "(2.1 to 2.3)", "(2.6, 3.17)", "(5)". Only groups made of
# numbers, dots, commas and the words "to" and "and" are read as citations, so prose in
# parentheses is left alone.
GROUP = re.compile(r"\(([\d.,\s]|\bto\b|\band\b)+\)")
# The one citation this file makes outside parentheses, as rule 1.3 spells it.
PLAIN = re.compile(r"such as (\d+\.\d+)")
# A number with three parts is a version, such as (0.37.2) in the decisions, not a citation.
VERSION = re.compile(r"\d+\.\d+\.\d+")
CITED = re.compile(r"(?<![\d.])(\d+)\.(\d+)(?![\d.])")


def rules_of(text: str) -> dict[str, list[int]]:
    """The rule numbers under each section heading, in the order they are written."""
    found: dict[str, list[int]] = {}
    section: str | None = None
    for line in text.splitlines():
        heading = SECTION.match(line)
        if heading:
            section = heading.group(1)
            found.setdefault(section, [])
            continue
        rule = RULE.match(line)
        if rule and section is not None:
            found[section].append(int(rule.group(1)))

    return found


def numbering_faults(found: dict[str, list[int]]) -> list[str]:
    """Where the file's own numbering skips, repeats or does not start at 1."""
    faults = []
    sections = [int(n) for n in found]
    if sections != list(range(1, len(sections) + 1)):
        faults.append(f"sections are numbered {sections}, expected 1 to {len(sections)}")
    for section, numbers in found.items():
        if numbers and numbers != list(range(1, len(numbers) + 1)):
            faults.append(f"section {section} is numbered {numbers}, expected 1 to {len(numbers)}")

    return faults


def citations_of(text: str) -> set[tuple[int, str]]:
    """Every rule a file cites, with the line it is cited on."""
    found = set()
    for n, line in enumerate(text.splitlines(), 1):
        for group in GROUP.finditer(line):
            body = group.group(0)
            if VERSION.search(body):
                continue
            for cite in CITED.finditer(body):
                found.add((n, f"{cite.group(1)}.{cite.group(2)}"))
        for plain in PLAIN.finditer(line):
            found.add((n, plain.group(1)))

    return found


def files() -> list[Path]:
    paths = [Path(one) for one in SEARCHED_FILES if Path(one).exists()]
    for folder in SEARCHED:
        if Path(folder).is_dir():
            paths += [one for one in sorted(Path(folder).rglob("*")) if one.suffix in SUFFIXES]

    return paths


def main() -> int:
    if not GUIDELINES.exists():
        print(f"error: {GUIDELINES} is not here; run this from the repository root", file=sys.stderr)
        return 2

    found = rules_of(GUIDELINES.read_text(encoding="utf-8"))
    known = {f"{section}.{number}" for section, numbers in found.items() for number in numbers}
    known |= set(found)  # a section on its own, as the review checklist cites it

    problems = [f"{GUIDELINES}: {fault}" for fault in numbering_faults(found)]

    checked = 0
    for path in files():
        for line, rule in sorted(citations_of(path.read_text(encoding="utf-8"))):
            checked += 1
            if rule not in known:
                problems.append(f"{path}:{line}: cites {rule}, which no rule has")

    for problem in problems:
        print(f"error: {problem}", file=sys.stderr)
    if problems:
        return 1

    print(f"{len(known)} rules in {len(found)} sections, {checked} citations in {len(files())} files, all resolved")

    return 0


if __name__ == "__main__":
    sys.exit(main())
