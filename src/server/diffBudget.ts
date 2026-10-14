/**
 * Fit a unified diff into a character budget without cutting a file in half.
 *
 * Files are kept whole, in diff order, until the budget is spent; the rest are
 * listed by path so the agent knows exactly what it has not seen and can open
 * those files in the checkout. A blind `slice(0, n)` hid the test files of a
 * large PR from the analysis and the agent judged test coverage it never saw.
 */
export function budgetDiff(diff: string, maxChars: number, options: { hasCheckout?: boolean } = {}): { text: string; omitted: string[] } {
  if (diff.length <= maxChars) return { text: diff, omitted: [] };
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
  return { text: kept.join("") + footer, omitted };
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
