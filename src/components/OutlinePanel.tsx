import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdf/loader";
import { loadOutline, type OutlineNode } from "../lib/pdf/navigation";
import { Panel } from "./Panel";

const cache = new WeakMap<PDFDocumentProxy, Promise<OutlineNode[]>>();
const outlineOf = (doc: PDFDocumentProxy) => {
  let p = cache.get(doc);
  if (!p) {
    p = loadOutline(doc).catch(() => []);
    cache.set(doc, p);
  }
  return p;
};

/** The last entry (in reading order) that starts at or before the current page. */
export function currentEntry(nodes: OutlineNode[], pageIndex: number): OutlineNode | null {
  let best: OutlineNode | null = null;
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.pageIndex !== null && n.pageIndex <= pageIndex && (best === null || n.pageIndex >= (best.pageIndex ?? -1))) best = n;
      walk(n.children);
    }
  };
  walk(nodes);
  return best;
}

interface OutlinePanelProps {
  doc: PDFDocumentProxy;
  pageIndex: number;
  onGo(pageIndex: number): void;
  onClose(): void;
}

/** RDR-10: the PDF's table of contents; tapping an entry jumps there. */
export function OutlinePanel({ doc, pageIndex, onGo, onClose }: OutlinePanelProps) {
  const [nodes, setNodes] = useState<OutlineNode[] | null>(null);
  useEffect(() => {
    let alive = true;
    void outlineOf(doc).then((n) => alive && setNodes(n));
    return () => {
      alive = false;
    };
  }, [doc]);

  const current = nodes ? currentEntry(nodes, pageIndex) : null;

  const renderList = (list: OutlineNode[], depth: number) => (
    <ul className={depth ? "ml-4 border-l border-ink/15 pl-2" : ""}>
      {list.map((node, i) => (
        <li key={`${depth}-${i}`}>
          {node.url && node.pageIndex === null ? (
            <a href={node.url} target="_blank" rel="noopener noreferrer" className="outline-row">
              <span className="flex-1">{node.title}</span>
              <span className="text-sm text-ink-muted">↗</span>
            </a>
          ) : (
            <button
              type="button"
              className="outline-row"
              disabled={node.pageIndex === null}
              aria-current={node === current ? "location" : undefined}
              onClick={() => node.pageIndex !== null && onGo(node.pageIndex)}
            >
              <span className="flex-1">{node.title}</span>
              {node.pageIndex !== null && <span className="text-sm tabular-nums text-ink-muted">{node.pageIndex + 1}</span>}
            </button>
          )}
          {node.children.length > 0 && renderList(node.children, depth + 1)}
        </li>
      ))}
    </ul>
  );

  return (
    <Panel title="Contents" onClose={onClose} testId="outline-panel">
      {nodes === null ? (
        <p role="status" className="text-ink-muted">
          Loading contents…
        </p>
      ) : nodes.length === 0 ? (
        <p className="text-ink-muted">This PDF has no table of contents. Use thumbnails or Go to page instead.</p>
      ) : (
        <nav aria-label="Table of contents">{renderList(nodes, 0)}</nav>
      )}
    </Panel>
  );
}
