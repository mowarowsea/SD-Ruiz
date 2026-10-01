import { faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type ReactNode, useState } from "react";

/** 見出しと (i)。説明は (i) を押したときだけ出す。aside は右端に置くボタンなど */
export function Heading({ as = "h2", info, aside, children }: { as?: "h1" | "h2"; info: string; aside?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const H = as;
  return (
    <div className={as === "h1" ? "mb-4" : "mb-2"}>
      <div className="flex items-center gap-2">
        <H className={as === "h1" ? "text-xl font-semibold" : "text-sm font-semibold"}>{children}</H>
        <button onClick={() => setOpen((v) => !v)} aria-label="説明" className={`text-sm ${open ? "text-accent" : "text-muted"}`}>
          <FontAwesomeIcon icon={faCircleInfo} />
        </button>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {open && <p className="mt-2 rounded-lg bg-surface2 px-3 py-2 text-xs leading-relaxed break-all whitespace-pre-line">{info}</p>}
    </div>
  );
}
