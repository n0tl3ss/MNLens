import type { CSSProperties, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CodeFindBar, HighlightedCode, countMatches, matchingLineIndex } from "./CodeFind";

export function ColorizedDiff({ diff }: { diff: string }) {
  const lines = preparedDisplayLines(diff);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineMatchCounts = useMemo(() => lines.map((line) => countMatches(line.code, query)), [lines, query]);
  const totalMatches = lineMatchCounts.reduce((sum, count) => sum + count, 0);
  const activeLineIndex = query.trim() ? matchingLineIndex(lineMatchCounts, activeMatch) : -1;
  const maxLineChars = Math.max(24, ...lines.map((line) => line.code.length + 4));

  useEffect(() => {
    if (!findOpen) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [findOpen]);

  useEffect(() => {
    if (activeMatch >= totalMatches) setActiveMatch(0);
  }, [activeMatch, totalMatches]);

  useEffect(() => {
    if (activeLineIndex < 0) return;
    containerRef.current?.querySelector(".code-find-active")?.scrollIntoView({ block: "center" });
  }, [activeLineIndex, activeMatch]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFindOpen(true);
    }
    if (event.key === "Escape" && findOpen) {
      setFindOpen(false);
      setQuery("");
    }
  }

  function nextMatch(delta: 1 | -1) {
    if (totalMatches === 0) return;
    setActiveMatch((current) => (current + delta + totalMatches) % totalMatches);
  }

  return (
    <div className="code-editor-shell" ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown}>
      {findOpen && (
        <CodeFindBar
          query={query}
          total={totalMatches}
          active={activeMatch}
          inputRef={inputRef}
          onQueryChange={(value) => {
            setQuery(value);
            setActiveMatch(0);
          }}
          onNext={() => nextMatch(1)}
          onPrevious={() => nextMatch(-1)}
          onClose={() => {
            setFindOpen(false);
            setQuery("");
          }}
        />
      )}
      <div className="prepared-diff" role="table" aria-label="Prepared code diff">
      {lines.map((line, index) => (
        <div
          className={`prepared-code-line ${line.kind} ${index === activeLineIndex ? "code-find-active" : ""}`}
          key={`${index}-${line.oldLine}-${line.newLine}-${line.code.slice(0, 20)}`}
          role="row"
          style={{ "--prepared-line-width": `calc(136px + ${maxLineChars}ch)` } as CSSProperties & Record<string, string>}
        >
          <span className="prepared-line-no old" role="cell">{line.oldLine ?? ""}</span>
          <span className="prepared-line-no new" role="cell">{line.newLine ?? ""}</span>
          <span className="prepared-line-sign" role="cell">{line.sign}</span>
          <code role="cell">
            <HighlightedCode text={line.code || " "} query={query} />
          </code>
        </div>
      ))}
      </div>
    </div>
  );
}

function preparedDisplayLines(diff: string): Array<{ kind: "add" | "del" | "context" | "note"; oldLine?: number; newLine?: number; sign: string; code: string }> {
  const rows: Array<{ kind: "add" | "del" | "context" | "note"; oldLine?: number; newLine?: number; sign: string; code: string }> = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (isPatchMetadataLine(line)) continue;
    if (!inHunk) {
      if (line.trim()) rows.push({ kind: "note", sign: "", code: line });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", newLine, sign: "+", code: line.slice(1) });
      newLine += 1;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", oldLine, sign: "-", code: line.slice(1) });
      oldLine += 1;
    } else {
      const code = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({ kind: "context", oldLine, newLine, sign: "", code });
      oldLine += 1;
      newLine += 1;
    }
  }
  return rows;
}

function isPatchMetadataLine(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("\\ No newline")
  );
}
