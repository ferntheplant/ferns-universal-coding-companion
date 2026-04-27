import { useLayoutEffect, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Tree, type NodeRendererProps } from "react-arborist";
import { sidebarTreeDataAtom, type SidebarTreeNode } from "../state/files";
import { activeFileIdAtom, fileFilterAtom } from "../state/ui";

export function Sidebar() {
  const [filter, setFilter] = useAtom(fileFilterAtom);
  const [activeFileId, setActiveFileId] = useAtom(activeFileIdAtom);
  const treeData = useAtomValue(sidebarTreeDataAtom);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const treeHorizontalInset = 24;

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setSize({
        width: Math.max(0, Math.floor(element.clientWidth)),
        height: Math.max(0, Math.floor(element.clientHeight)),
      });
    });

    observer.observe(element);
    setSize({
      width: Math.max(0, Math.floor(element.clientWidth)),
      height: Math.max(0, Math.floor(element.clientHeight)),
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar__header">Files</div>
      <input
        className="sidebar__filter"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter files"
      />
      <div className="sidebar__tree" ref={containerRef}>
        {size.width > 0 && size.height > 0 ? (
          <Tree<SidebarTreeNode>
            data={treeData}
            width={Math.max(0, size.width - treeHorizontalInset)}
            height={size.height}
            rowHeight={30}
            indent={18}
            openByDefault
            disableDrag
            disableEdit
            disableMultiSelection
            selection={activeFileId ?? undefined}
            searchTerm={filter.trim()}
            searchMatch={(node, term) => node.data.path.toLowerCase().includes(term.trim().toLowerCase())}
            onActivate={(node) => {
              if (node.data.kind === "file" && node.data.fileId) {
                setActiveFileId(node.data.fileId);
              }
            }}
          >
            {SidebarTreeRow}
          </Tree>
        ) : null}
      </div>
    </aside>
  );
}

function SidebarTreeRow({ node, style, dragHandle }: NodeRendererProps<SidebarTreeNode>) {
  const data = node.data;

  if (data.kind === "folder") {
    return (
      <div style={style} className="sidebar-tree__row-wrap">
        <div
          ref={dragHandle}
          className="sidebar-tree__row"
          data-kind="folder"
          data-open={node.isOpen}
          onClick={(event) => {
            node.handleClick(event);
            node.toggle();
          }}
          title={data.path}
        >
          <span className="sidebar-tree__caret">{node.isOpen ? "▾" : "▸"}</span>
          <span className="sidebar-tree__icon" aria-hidden>
            {node.isOpen ? "📂" : "📁"}
          </span>
          <span className="sidebar-tree__name">{data.name}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={style} className="sidebar-tree__row-wrap">
      <div
        ref={dragHandle}
        className="sidebar-tree__row"
        data-kind="file"
        data-selected={node.isSelected}
        onClick={node.handleClick}
        title={data.path}
      >
        <span className="sidebar-tree__caret sidebar-tree__caret--placeholder" aria-hidden>
          •
        </span>
        <span className="sidebar-tree__icon" aria-hidden>
          📄
        </span>
<span className="sidebar-tree__name">{data.name}</span>
        {data.commentCount ? (
          <span className="sidebar-tree__comment-count" title={`${data.commentCount} comment${data.commentCount === 1 ? "" : "s"}`}>
            💬 {data.commentCount}
          </span>
        ) : null}
        <span className="sidebar-tree__stats">
          <span className="sidebar-tree__stat sidebar-tree__stat--add">+{data.additions ?? 0}</span>
          <span className="sidebar-tree__stat sidebar-tree__stat--del">-{data.deletions ?? 0}</span>
        </span>
      </div>
    </div>
  );
}

