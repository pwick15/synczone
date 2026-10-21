import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { GridModel, OverlapLevels } from "../schedule";
import { fmtDateKey, fmtMinute } from "../time";

interface Rect {
  d0: number;
  d1: number;
  r0: number;
  r1: number;
}

interface Props {
  model: GridModel;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  /** Where everyone overlaps (2) and the buffer around it (1). */
  overlap: OverlapLevels;
  /** How strongly to tint each slot for other people being free (0–100). */
  tint: Uint8Array;
  /** Slot range [start, end) to outline as the locked-in time. */
  chosen: [number, number] | null;
  /** The slot under the pointer (or last touched), for the who's-free readout. */
  onHover: (slot: number | null) => void;
}

const cellAt = (x: number, y: number) => {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-di]");
  return el ? [Number(el.dataset.di), Number(el.dataset.ri)] : null;
};

const toRect = (a: number[], b: number[]): Rect => ({
  d0: Math.min(a[0], b[0]),
  d1: Math.max(a[0], b[0]),
  r0: Math.min(a[1], b[1]),
  r1: Math.max(a[1], b[1]),
});

const sameRect = (a: Rect, b: Rect) => a.d0 === b.d0 && a.d1 === b.d1 && a.r0 === b.r0 && a.r1 === b.r1;

const inRect = (r: Rect | null, di: number, ri: number) =>
  !!r && di >= r.d0 && di <= r.d1 && ri >= r.r0 && ri <= r.r1;

const OVERLAP_CLASS = ["", " buffer", " common"];

export function Grid({ model, selected, onChange, overlap, tint, chosen, onHover }: Props) {
  const drag = useRef<{ anchor: number[]; adding: boolean } | null>(null);
  const [preview, setPreview] = useState<{ rect: Rect; adding: boolean } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const pos = cellAt(e.clientX, e.clientY);
    if (!pos || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const slot = model.at(pos[0], pos[1]);
    onHover(slot ?? null);
    const adding = slot === undefined || !selected.has(slot);
    drag.current = { anchor: pos, adding };
    setPreview({ rect: toRect(pos, pos), adding });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const pos = cellAt(e.clientX, e.clientY);
    if (e.pointerType === "mouse" || drag.current) onHover(pos ? (model.at(pos[0], pos[1]) ?? null) : null);
    if (!drag.current || !pos) return;
    const rect = toRect(drag.current.anchor, pos);
    const adding = drag.current.adding;
    setPreview((p) => (p && sameRect(p.rect, rect) ? p : { rect, adding }));
  };

  const finish = () => {
    if (!drag.current || !preview) return;
    const next = new Set(selected);
    for (let di = preview.rect.d0; di <= preview.rect.d1; di++) {
      for (let ri = preview.rect.r0; ri <= preview.rect.r1; ri++) {
        const slot = model.at(di, ri);
        if (slot === undefined) continue;
        if (preview.adding) next.add(slot);
        else next.delete(slot);
      }
    }
    drag.current = null;
    setPreview(null);
    onChange(next);
  };

  const cancel = () => {
    drag.current = null;
    setPreview(null);
  };

  const style = { "--cols": model.dates.length } as CSSProperties;

  return (
    <div className="grid-scroll">
      <div
        className="grid"
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onPointerLeave={(e) => e.pointerType === "mouse" && !drag.current && onHover(null)}
        role="grid"
        aria-label="Your availability"
      >
        <div />
        {model.dates.map((d) => {
          const { weekday, date } = fmtDateKey(d);
          return (
            <div key={d} className="grid-day">
              <span>{weekday}</span>
              <strong>{date}</strong>
            </div>
          );
        })}
        {model.minutes.map((minute, ri) => (
          <Row key={minute} minute={minute} ri={ri}>
            {model.dates.map((d, di) => {
              const slot = model.at(di, ri);
              if (slot === undefined) return <div key={d} className="cell off" data-di={di} data-ri={ri} />;
              const on = inRect(preview?.rect ?? null, di, ri) ? preview!.adding : selected.has(slot);
              let cls = "cell" + OVERLAP_CLASS[overlap[slot]];
              let cellStyle: CSSProperties | undefined;
              if (tint[slot] && overlap[slot] !== 2) {
                cls += " tint";
                cellStyle = { "--o": `${tint[slot]}%` } as CSSProperties;
              }
              if (on) cls += " on";
              if (chosen && slot >= chosen[0] && slot < chosen[1]) cls += " locked";
              if (minute % 60 === 0) cls += " hour";
              return <div key={d} className={cls} style={cellStyle} data-di={di} data-ri={ri} />;
            })}
          </Row>
        ))}
      </div>
    </div>
  );
}

function Row({ minute, ri, children }: { minute: number; ri: number; children: ReactNode }) {
  return (
    <>
      <div className={`grid-time${minute % 60 === 0 ? " hour" : ""}`} data-ri={ri}>
        {minute % 60 === 0 || ri === 0 ? fmtMinute(minute) : ""}
      </div>
      {children}
    </>
  );
}
