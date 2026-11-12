import type { Ref } from "react";
import { parseSheet } from "../../shared/sheet";

export default function ChordSheet({
  content,
  onTap,
  fontSize,
  sheetRef,
}: {
  content: string;
  onTap?: () => void;
  fontSize?: number;
  sheetRef?: Ref<HTMLDivElement>;
}) {
  const lines = parseSheet(content);
  return (
    <div
      ref={sheetRef}
      className="sheet sheet-full"
      onClick={onTap}
      data-testid="sheet"
      style={fontSize ? { fontSize } : undefined}
    >
      {lines.map((line, i) =>
        line.kind === "section" ? (
          <div key={i} className="sheet-line sheet-section">{`[${line.label}]`}</div>
        ) : (
          <div key={i} className="sheet-line">
            {line.parts.map((p, j) =>
              p.type === "chord" ? (
                <span key={j} className="chord">{p.chord}</span>
              ) : (
                <span key={j}>{p.text}</span>
              ),
            )}
          </div>
        ),
      )}
    </div>
  );
}
