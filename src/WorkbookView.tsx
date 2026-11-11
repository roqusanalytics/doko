import { useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";
import TableView from "./TableView";
import "./workbook-view.css";

// One sheet at a time as a read-only table, with the sheets as tabs below it (arrow keys move between them).
export default function WorkbookView({ workbook, selected, onSelect }: { workbook: WorkbookDocument; selected: number; onSelect: (index: number) => void }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const sheet = workbook.sheets[selected];
  const columns = useMemo(() => sheet?.rows.reduce((widest, row) => Math.max(widest, row.length), 0) ?? 0, [sheet]);
  if (!sheet) return <div className="tv-empty" role="status">This workbook has no worksheets to show.</div>;

  const choose = (index: number) => { onSelect(index); tabs.current[index]?.focus(); };
  const onKeyDown = (event: KeyboardEvent) => {
    const last = workbook.sheets.length - 1;
    const next = event.key === "ArrowRight" ? Math.min(selected + 1, last) : event.key === "ArrowLeft" ? Math.max(selected - 1, 0)
      : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    choose(next);
  };
  const notice = sheet.truncated ? "This sheet is too large to show completely. Only the first part is shown."
    // A truncated sheet explains the workbook flag; without one, whole sheets were left out.
    : workbook.truncated && !workbook.sheets.some(item => item.truncated) ? "This workbook has more sheets than Doko can show." : "";

  return <>
    {notice && <div className="content-notice" role="status"><span>{notice}</span></div>}
    <div className="workbook-panel" role="tabpanel" id="sheet-panel" aria-labelledby={`sheet-tab-${selected}`}>
      <TableView key={selected} readOnly rows={sheet.rows} columns={columns} label={`Sheet ${sheet.name}`}
        empty={sheet.truncated ? "Nothing from this sheet could be shown." : "This sheet is empty."} />
    </div>
    <div className="sheet-tabs" role="tablist" aria-label="Sheets" onKeyDown={onKeyDown}>
      {workbook.sheets.map((item, index) => <button key={index} ref={element => { tabs.current[index] = element; }} type="button" role="tab"
        id={`sheet-tab-${index}`} aria-selected={index === selected} aria-controls="sheet-panel" tabIndex={index === selected ? 0 : -1}
        className="sheet-tab" title={item.name} onClick={() => choose(index)}>{item.name || `Sheet ${index + 1}`}</button>)}
    </div>
  </>;
}
