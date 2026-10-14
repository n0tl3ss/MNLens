/**
 * GitHub "suggestion" blocks: a fenced ```suggestion``` block in a review
 * comment lets the author apply the replacement with one click. MNLens keeps
 * the suggested code separate from the comment text so the UI can show it as
 * code and the reviewer can still edit the prose.
 */
export function commentBodyWithSuggestion(body: string, suggestion?: string | null): string {
  const text = body.trim();
  const code = (suggestion ?? "").replace(/\s+$/, "");
  if (!code.trim()) return text;
  return `${text}\n\n\`\`\`suggestion\n${code}\n\`\`\``;
}
