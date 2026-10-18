"use client";

import { useEffect, useId, useRef, useState } from "react";

type EquipmentFilterProps = { options: string[]; selected: string[]; onChange: (selected: string[]) => void };

/** Dropdown of checkboxes for picking the equipment a room must have. */
export function EquipmentFilter({ options, selected, onChange }: EquipmentFilterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(option: string) {
    onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
  }

  const label = selected.length === 0 ? "Equipment" : selected.length === 1 ? selected[0] : `Equipment (${selected.length})`;

  return <div className="equipment-filter" ref={rootRef}>
    <button type="button" className={`filter equipment-toggle ${selected.length ? "has-value" : ""}`} ref={buttonRef} aria-haspopup="true" aria-expanded={open} aria-controls={panelId} aria-label={selected.length ? `Filter equipment: ${selected.join(", ")}` : "Filter equipment"} onClick={() => setOpen(!open)}>
      <span className="equipment-toggle-label">{label}</span>
    </button>
    {open && <div className="equipment-panel" id={panelId}>
      <fieldset>
        <legend>Equipment</legend>
        {options.length
          ? options.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} /> {option}</label>)
          : <p className="equipment-empty">No equipment listed.</p>}
      </fieldset>
      {selected.length > 0 && <button type="button" className="text-button" onClick={() => onChange([])}>Clear</button>}
    </div>}
  </div>;
}
