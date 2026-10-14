/**
 * Fit a unified diff into a character budget without cutting a file in half.
 *
 * Files are kept whole, in diff order, until the budget is spent; the rest are
 * listed by path so the agent knows exactly what it has not seen and can open
 * those files in the checkout. A blind `slice(0, n)` hid the test files of a
 * large PR from the analysis and the agent judged test coverage it never saw.
 */
export function budgetDiff(
  diff: string,
  maxChars: number,
  options: {
    hasCheckout?: boolean;
    /**
     * Replace the hunks of newly added files with a one-line stub naming the file. For a run that
     * works inside the checkout a new file's diff is the file itself: leaving it out makes the agent
     * open it (and the code around it) instead of reviewing it from the prompt.
     */
    stubAddedFiles?: boolean;
  } = {}
): { text: string; omitted: string[]; stubbed: string[] } {
  const stubbed: string[] = [];
  if (options.stubAddedFiles) {
    diff = splitDiffByFile(diff)
      .map((section) => {
        if (!isAddedFileSection(section.text)) return section.text;
        stubbed.push(section.path);
        const added = section.text.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
        return `diff --git a/${section.path} b/${section.path}\n[new file, ${added} lines: not shown here, read it in the checkout]\n`;
      })
      .join("");
  }
  if (diff.length <= maxChars) return { text: diff, omitted: [], stubbed };
  const sections = splitDiffByFile(diff);
  const kept: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const section of sections) {
    if (omitted.length === 0 && used + section.text.length <= maxChars) {
      kept.push(section.text);
      used += section.text.length;
    } else if (kept.length === 0) {
      // The first file alone is over budget: keep its head so the agent sees something.
      kept.push(`${section.text.slice(0, maxChars)}\n[${section.path} truncated from ${section.text.length} characters.]`);
      used = maxChars;
    } else {
      omitted.push(section.path);
    }
  }
  const footer =
    omitted.length > 0
      ? `\n\n[${omitted.length} file${omitted.length === 1 ? "" : "s"} omitted from this diff to stay within ${maxChars} characters: ${omitted.join(", ")}. ${
          options.hasCheckout ? "Read them from the checkout before judging tests, docs or completeness." : "Judge them from the file list only and say so in caveats."
        }]`
      : "";
  return { text: kept.join("") + footer, omitted, stubbed };
}

/**
 * One line per file instead of its hunks: path, change kind, +/- counts and the
 * new-file line range of every hunk. Enough for a pass that only structures
 * someone else's notes to emit valid paths and `R`-line ranges without being
 * handed the whole diff again (which costs tokens and invites a second review).
 */
export function diffOutline(diff: string): string {
  return splitDiffByFile(diff)
    .filter((section) => section.path !== "(preamble)" && section.path !== "(diff)")
    .map((section) => {
      const lines = section.text.split("\n");
      const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      const removed = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
      const kind = isAddedFileSection(section.text)
        ? "added"
        : lines.some((line) => line.startsWith("deleted file mode"))
          ? "deleted"
          : lines.some((line) => line.startsWith("rename from"))
            ? "renamed"
            : "modified";
      const hunks: string[] = [];
      for (const match of section.text.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@(.*)$/gm)) {
        const start = Number(match[1]);
        const count = match[2] === undefined ? 1 : Number(match[2]);
        if (count === 0) continue;
        const context = match[3].trim();
        hunks.push(`R${start}-${start + count - 1}${context ? ` (${context.slice(0, 60)})` : ""}`);
      }
      return `${section.path} (${kind}, +${added} -${removed})${hunks.length > 0 ? `: ${hunks.join("; ")}` : ""}`;
    })
    .join("\n");
}

function isAddedFileSection(section: string): boolean {
  const header = section.split("\n", 6);
  return header.some((line) => line.startsWith("new file mode")) || header.some((line) => line === "--- /dev/null");
}

function splitDiffByFile(diff: string): Array<{ path: string; text: string }> {
  const sections: Array<{ path: string; text: string }> = [];
  const pattern = /^diff --git a\/(.+?) b\/(.+)$/gm;
  let match: RegExpExecArray | null;
  const starts: Array<{ index: number; path: string }> = [];
  while ((match = pattern.exec(diff)) !== null) starts.push({ index: match.index, path: match[2] });
  if (starts.length === 0) return [{ path: "(diff)", text: diff }];
  if (starts[0].index > 0) sections.push({ path: "(preamble)", text: diff.slice(0, starts[0].index) });
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : diff.length;
    sections.push({ path: start.path, text: diff.slice(start.index, end) });
  });
  return sections;
}
