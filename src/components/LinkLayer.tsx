import { useContext, useEffect, useState } from "react";
import { loadPageLinks, type PageLink } from "../lib/pdf/navigation";
import { useReaderStore } from "../store/reader";
import { PageContext } from "./PdfPage";

/**
 * RDR-12: clickable areas over a page's PDF links. Internal links jump inside the
 * book; external ones open in a new tab (http/https/mailto only). They are real
 * <button>/<a> elements, so page-flip (clickEventForward) and the tap zones ignore them.
 */
export function LinkLayer({ index }: { index: number }) {
  const ctx = useContext(PageContext);
  const [links, setLinks] = useState<PageLink[]>([]);

  useEffect(() => {
    if (!ctx) return;
    let alive = true;
    loadPageLinks(ctx.doc, index + 1, ctx.width).then(
      (l) => alive && setLinks(l),
      () => alive && setLinks([]),
    );
    return () => {
      alive = false;
    };
  }, [ctx, index]);

  if (links.length === 0) return null;
  return (
    <div className="pt-link-layer">
      {links.map((link, i) => {
        const style = { left: link.rect.left, top: link.rect.top, width: link.rect.width, height: link.rect.height };
        if (link.kind === "internal") {
          return (
            <button
              key={i}
              type="button"
              className="pt-link"
              style={style}
              aria-label={`Go to page ${link.pageIndex + 1}`}
              data-link-page={link.pageIndex + 1}
              onClick={(e) => {
                e.stopPropagation();
                useReaderStore.getState().navigate(link.pageIndex);
              }}
            />
          );
        }
        let host = link.url;
        try {
          host = new URL(link.url).host || link.url;
        } catch {
          /* keep url */
        }
        return (
          <a
            key={i}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="pt-link"
            style={style}
            aria-label={`Open ${host} in a new tab`}
            onClick={(e) => e.stopPropagation()}
          />
        );
      })}
    </div>
  );
}
