import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "./actionMenu.css";

export interface ActionMenuItem {
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  /** Shown as a checkmark state for toggles (attention mode, filters). */
  checked?: boolean;
}

/**
 * Secondary actions behind one button, so the primary action row stays
 * short. Closes on select, Escape, or a click outside.
 */
export function ActionMenu({ label, icon, items, title, className = "" }: { label?: ReactNode; icon?: ReactNode; items: ActionMenuItem[]; title?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`action-menu ${open ? "open" : ""} ${className}`} ref={ref}>
      <button type="button" className={label ? "" : "icon-button"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} title={title}>
        {icon ?? <MoreHorizontal size={16} />}
        {label}
      </button>
      {open && (
        <div className="action-menu-list" role="menu">
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              role="menuitem"
              className={`${item.danger ? "danger" : ""} ${item.checked ? "checked" : ""}`}
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.checked !== undefined && <span className="action-menu-check" aria-hidden>{item.checked ? "✓" : ""}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
