import { parseSheet } from "../../shared/sheet";

export default function ChordSheet({ content, onTap }: { content: string; onTap?: () => void }) {
  const lines = parseSheet(content);
  return (
    <div className="sheet sheet-full" onClick={onTap} data-testid="sheet">
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
