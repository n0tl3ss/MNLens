import { useMemo, useState } from "react";
import { ColorizedDiff } from "./DiffCode";
import "./preparedDiff.css";

type PreparedDiffFile = { path: string; diff: string; additions: number; deletions: number };

type PreparedTreeNode = {
  name: string;
  path: string;
  children: PreparedTreeNode[];
  file?: PreparedDiffFile;
};

export function PreparedDiff({ diff }: { diff: string }) {
  const files = parsePreparedDiffFiles(diff);
  const [activePath, setActivePath] = useState(files[0]?.path ?? "Full patch");
  const tree = useMemo(() => buildPreparedFileTree(files), [files]);
  const active = files.find((file) => file.path === activePath);
  if (files.length === 0) {
    return <ColorizedDiff diff={diff} />;
  }
  return (
    <div className="prepared-diff-review">
      <PreparedFileTree nodes={tree} activePath={activePath} onSelect={setActivePath} />
      <div className="prepared-file-diff">
        <div className="prepared-file-heading">
          <strong>{active?.path ?? activePath}</strong>
          {active && (
            <span>
              <b className="added">+{active.additions}</b>
              <b className="deleted">-{active.deletions}</b>
            </span>
          )}
        </div>
        <ColorizedDiff diff={active?.diff ?? diff} />
      </div>
    </div>
  );
}

export function parsePreparedDiffFiles(diff: string): Array<{ path: string; diff: string; additions: number; deletions: number }> {
  const lines = stripPatchPreamble(diff).split("\n");
  const files: Array<{ path: string; diff: string; additions: number; deletions: number }> = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current.length > 0) files.push(preparedFileFromLines(current));
      current = [line];
      continue;
    }
    if (current.length > 0) current.push(line);
  }
  if (current.length > 0) files.push(preparedFileFromLines(current));
  return files.filter((file) => file.path.trim().length > 0);
}

function PreparedFileTree({
  nodes,
  activePath,
  onSelect
}: {
  nodes: PreparedTreeNode[];
  activePath: string;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="prepared-file-tabs" aria-label="Prepared changed files">
      {nodes.map((node) => (
        <PreparedTreeRow activePath={activePath} key={node.path} node={node} onSelect={onSelect} />
      ))}
    </div>
  );
}

function PreparedTreeRow({
  node,
  activePath,
  onSelect,
  depth = 0
}: {
  node: PreparedTreeNode;
  activePath: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  if (node.file) {
    return (
      <button
        className={`prepared-file-row ${node.file.path === activePath ? "active" : ""}`}
        onClick={() => onSelect(node.file!.path)}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        <span>
          <strong>{node.name}</strong>
          <small>{node.file.path}</small>
        </span>
        <em>
          <b className="added">+{node.file.additions}</b>
          <b className="deleted">-{node.file.deletions}</b>
        </em>
      </button>
    );
  }
  return (
    <div className="prepared-tree-group">
      <div className="prepared-tree-dir" style={{ paddingLeft: 10 + depth * 14 }}>
        <span>{node.name}/</span>
      </div>
      {node.children.map((child) => (
        <PreparedTreeRow activePath={activePath} depth={depth + 1} key={child.path} node={child} onSelect={onSelect} />
      ))}
    </div>
  );
}

function buildPreparedFileTree(files: PreparedDiffFile[]): PreparedTreeNode[] {
  const root: PreparedTreeNode = { name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");
      let child = current.children.find((node) => node.name === part && Boolean(node.file) === isFile);
      if (!child) {
        child = { name: part, path, children: [] };
        current.children.push(child);
      }
      if (isFile) child.file = file;
      current = child;
    });
  }
  return sortPreparedTree(root.children);
}

function sortPreparedTree(nodes: PreparedTreeNode[]): PreparedTreeNode[] {
  return nodes
    .map((node) => ({ ...node, children: sortPreparedTree(node.children) }))
    .sort((a, b) => {
      if (Boolean(a.file) !== Boolean(b.file)) return a.file ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

function preparedFileFromLines(lines: string[]): { path: string; diff: string; additions: number; deletions: number } {
  const header = lines[0] ?? "";
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
  const path = match?.[2] ?? lines.find((line) => line.startsWith("+++ b/"))?.slice(6) ?? lines.find((line) => line.startsWith("--- a/"))?.slice(6) ?? "Changed file";
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { path, diff: lines.join("\n"), additions, deletions };
}

function stripPatchPreamble(diff: string): string {
  const marker = diff.indexOf("diff --git ");
  return marker >= 0 ? diff.slice(marker) : diff;
}
