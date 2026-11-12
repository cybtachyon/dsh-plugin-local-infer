#!/usr/bin/env python3
"""Reject commit messages that attribute work to an external assistant.

prek runs this hook at the commit-msg stage with the commit message file
path as its single argument. Deliberate exceptions bypass it with
`git commit --no-verify`.
"""

import re
import subprocess
import sys

# "claude" matches the assistant name; "anthropic" matches the company and
# its noreply address, so noreply@anthropic.com needs no third alternative.
REJECTED_ATTRIBUTION = re.compile(r"(?i)claude|anthropic")

# git emits the scissors line commented out but leaves the diff below it
# uncommented, so comment-stripping alone cannot reach that diff and the
# cut must happen before any comment handling.
SCISSORS_LINE = re.compile(r"^\s*#?\s*-{8,}\s*>8\s*-{8,}\s*$")


def recorded_message(raw: str) -> str:
    """Return the text git will store from the editor file text raw.

    git's own tool does the comment rule; `git stripspace
    --strip-comments` ignores the scissors line, so the truncation runs
    first. If git is unavailable the truncated text is scanned as-is,
    which fails closed (it may over-report, never miss).
    """
    lines = raw.splitlines()
    for index, line in enumerate(lines):
        if SCISSORS_LINE.match(line):
            del lines[index:]
            break
    truncated = "\n".join(lines)
    try:
        stripspace = subprocess.run(
            ["git", "stripspace", "--strip-comments"],
            check=False,
            input=truncated,
            text=True,
            capture_output=True,
        )
    except OSError:
        # Missing git binary: take the documented fail-closed fallback
        # route here too; a spawn failure is the same case as a bad exit.
        return truncated
    return stripspace.stdout if stripspace.returncode == 0 else truncated


def offending_lines(message: str) -> list[int]:
    """Return the 1-based line numbers whose text matches the pattern.

    Reported numbers count lines of the message git will record, not of
    the editor buffer the hook receives.
    """
    return [
        number
        for number, line in enumerate(message.splitlines(), start=1)
        if REJECTED_ATTRIBUTION.search(line)
    ]


def main(argv: list[str]) -> int:
    """Check the message file at argv[1]; 0 accepts, 1 rejects, 2 is usage."""
    if len(argv) != 2:
        print(
            "usage: check_commit_msg_attribution.py <commit-msg-file>",
            file=sys.stderr,
        )
        return 2
    try:
        with open(argv[1], encoding="utf-8") as message_file:
            message = message_file.read()
    except OSError as error:
        print(f"error: cannot read {argv[1]}: {error}", file=sys.stderr)
        return 2
    hits = offending_lines(recorded_message(message))
    if not hits:
        return 0
    numbers = ", ".join(str(number) for number in hits)
    print(
        f"rejected: line(s) {numbers} attribute work to an external assistant.\n"
        "This plugin was built with DeepSeek Harness and the local Qwen model,\n"
        "so its commit messages carry no external assistant attribution.\n"
        "For a deliberate exception use: git commit --no-verify",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
