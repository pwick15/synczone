import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { GridModel } from "../schedule";
import { fmtDateKey, fmtMinute } from "../time";

interface Rect {
  d0: number;
  d1: number;
  r0: number;
  r1: number;
}

type Props = {
  model: GridModel;
  /** Slot range [start, end) to outline as the locked-in time. */
  chosen: [number, number] | null;
  /** Slot to outline as the one being inspected. */
  active?: number | null;
} & (
  | { mode: "edit"; selected: Set<number>; onChange: (next: Set<number>) => void }
  | { mode: "group"; counts: number[]; total: number; onInspect: (slot: number | null) => void }
);

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

const inRect = (r: Rect | null, di: number, ri: number) =>
  !!r && di >= r.d0 && di <= r.d1 && ri >= r.r0 && ri <= r.r1;

export function Grid(props: Props) {
  const { model, chosen, active } = props;
  const drag = useRef<{ anchor: number[]; adding: boolean } | null>(null);
  const [preview, setPreview] = useState<{ rect: Rect; adding: boolean } | null>(null);

  const isSelected = (slot: number) => props.mode === "edit" && props.selected.has(slot);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const pos = cellAt(e.clientX, e.clientY);
    if (!pos) return;
    if (props.mode === "group") {
      props.onInspect(model.at(pos[0], pos[1]) ?? null);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const slot = model.at(pos[0], pos[1]);
    const adding = slot === undefined || !isSelected(slot);
    drag.current = { anchor: pos, adding };
    setPreview({ rect: toRect(pos, pos), adding });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const pos = cellAt(e.clientX, e.clientY);
    if (props.mode === "group") {
      if (e.pointerType === "mouse") props.onInspect(pos ? (model.at(pos[0], pos[1]) ?? null) : null);
      return;
    }
    if (!drag.current || !pos) return;
    const rect = toRect(drag.current.anchor, pos);
    setPreview((p) =>
      p && p.rect.d0 === rect.d0 && p.rect.d1 === rect.d1 && p.rect.r0 === rect.r0 && p.rect.r1 === rect.r1
        ? p
        : { rect, adding: drag.current!.adding },
    );
  };

  const finish = () => {
    if (props.mode !== "edit" || !drag.current || !preview) return;
    const next = new Set(props.selected);
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
    props.onChange(next);
  };

  const cancel = () => {
    drag.current = null;
    setPreview(null);
  };

  const style = { "--cols": model.dates.length } as CSSProperties;

  return (
    <div className="grid-scroll">
      <div
        className={`grid grid-${props.mode}`}
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onPointerLeave={() => props.mode === "group" && props.onInspect(null)}
        role="grid"
        aria-label={props.mode === "edit" ? "Your availability" : "Everyone's availability"}
      >
        <div className="grid-corner" />
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
              let cls = "cell";
              let cellStyle: CSSProperties | undefined;
              if (props.mode === "edit") {
                const on = inRect(preview?.rect ?? null, di, ri) ? preview!.adding : isSelected(slot);
                if (on) cls += " on";
              } else {
                const c = props.counts[slot] ?? 0;
                if (c > 0) {
                  cls += " heat";
                  if (c === props.total && props.total > 1) cls += " full";
                  // Starts at 25% so a single free person is still clearly visible.
                  cellStyle = { "--level": `${Math.round(25 + (c / Math.max(props.total, 1)) * 75)}%` } as CSSProperties;
                }
              }
              if (chosen && slot >= chosen[0] && slot < chosen[1]) cls += " locked";
              if (active === slot) cls += " active";
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
