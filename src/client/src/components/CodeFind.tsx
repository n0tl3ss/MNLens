import { Search, X } from "lucide-react";
import type { RefObject } from "react";

export function CodeFindBar({
  query,
  total,
  active,
  inputRef,
  onQueryChange,
  onNext,
  onPrevious,
  onClose
}: {
  query: string;
  total: number;
  active: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  return (
    <div className="code-find-bar" role="search">
      <Search size={14} />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.shiftKey ? onPrevious() : onNext();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in diff"
      />
      <span>{query.trim() ? `${total === 0 ? 0 : active + 1}/${total}` : "0/0"}</span>
      <button type="button" disabled={total === 0} onClick={onPrevious}>
        Prev
      </button>
      <button type="button" disabled={total === 0} onClick={onNext}>
        Next
      </button>
      <button type="button" className="icon-button" title="Close find" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}

export function HighlightedCode({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const matchAt = lowerText.indexOf(lowerQuery, cursor);
    if (matchAt < 0) break;
    if (matchAt > cursor) parts.push({ text: text.slice(cursor, matchAt), match: false });
    parts.push({ text: text.slice(matchAt, matchAt + trimmed.length), match: true });
    cursor = matchAt + trimmed.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark className="code-find-match" key={`${part.text}-${index}`}>
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        )
      )}
    </>
  );
}

export function countMatches(value: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  const haystack = value.toLowerCase();
  while (cursor < haystack.length) {
    const matchAt = haystack.indexOf(needle, cursor);
    if (matchAt < 0) break;
    count += 1;
    cursor = matchAt + needle.length;
  }
  return count;
}

export function matchingLineIndex(lineMatchCounts: number[], activeMatch: number): number {
  let seen = 0;
  for (let index = 0; index < lineMatchCounts.length; index += 1) {
    seen += lineMatchCounts[index];
    if (activeMatch < seen) return index;
  }
  return -1;
}
