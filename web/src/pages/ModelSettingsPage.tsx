import { faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useMemo, useState } from "react";
import { api, type BaseSettings, baseSettingsOf, type ForgeModule, type GenerateParams, type Meta, type ModelParams, modelLabel, type Prefs } from "../api";
import { Heading } from "../components/Heading";
import type { usePrefs } from "../hooks";

const summary = (p: ModelParams) => `${p.width}×${p.height} · ${p.steps}st · CFG ${p.cfg} · ${p.sampler} · ${p.scheduler}`;

/**
 * ベースモデルごとの既定と、モデルごとの設定。
 * モデルを選んだときは、モデルごとの設定 (前回生成したときの値・個別に指定した TE / VAE) があればそれを、無ければベースモデルの既定を使う
 */
export function ModelSettingsPage({ meta, form, prefsState }: { meta: Meta | null; form: GenerateParams; prefsState: ReturnType<typeof usePrefs> }) {
  const { prefs, setPrefs } = prefsState;
  const [modules, setModules] = useState<ForgeModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.modules().then((r) => setModules(r.modules), (e) => setError((e as Error).message));
  }, []);

  const save = (p: Promise<Prefs>) =>
    p.then(
      (v) => {
        setPrefs(v);
        setError(null);
      },
      (e) => setError((e as Error).message),
    );

  // モデルがあるベースモデルと、設定があるベースモデル。モデルの多い順
  const groups = useMemo(() => {
    const map = new Map<string | null, string[]>();
    for (const f of Object.keys(prefs?.bases ?? {})) map.set(f, []);
    for (const m of meta?.models ?? []) map.set(m.family, [...(map.get(m.family) ?? []), m.title]);
    return [...map].sort((a, b) => (a[0] === null ? 1 : b[0] === null ? -1 : b[1].length - a[1].length));
  }, [meta, prefs]);

  return (
    <div className="pb-24">
      <Heading
        as="h1"
        info={
          "モデルを選んだときの設定は二段構えです。\n" +
          "・モデルごと: 前回そのモデルで生成したときのパラメータと、個別に指定した Text Encoder / VAE\n" +
          "・ベースモデルごと (Illustrious / Pony / Anima ...): モデルごとの設定が無いときに使う既定\n" +
          "パラメータは生成画面で値を決めてから「今の値にする」で既定にします。\n" +
          "Anima のように Checkpoint に Text Encoder と VAE が入っていないモデルは、ここで選んだものを生成のたびに Forge に渡します。それ以外は何も渡しません (Checkpoint に入っている VAE を使う)。\n" +
          "TE / VAE のファイルを足したら Forge を再起動してください (Forge は起動したときにしか一覧を読みません)"
        }
      >
        モデルの設定
      </Heading>
      {error && <p className="mb-2 text-xs break-words text-danger">{error}</p>}
      {!prefs || !meta ? (
        <p className="text-sm text-muted">読み込み中…</p>
      ) : (
        <div className="space-y-3">
          {groups.map(([family, titles]) => (
            <FamilyCard
              key={family ?? ""}
              family={family}
              titles={titles}
              base={baseSettingsOf(prefs, family)}
              prefs={prefs}
              form={form}
              modules={modules}
              onBase={(patch) => family && save(api.setBaseSettings(family, patch))}
              onModel={(id, patch) => save(api.setModelSettings(id, patch))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FamilyCard({
  family,
  titles,
  base,
  prefs,
  form,
  modules,
  onBase,
  onModel,
}: {
  family: string | null;
  titles: string[];
  base: BaseSettings;
  prefs: Prefs;
  form: GenerateParams;
  modules: ForgeModule[] | null;
  onBase: (patch: { params?: ModelParams | null; modules?: string[] | null }) => void;
  onModel: (id: string, patch: { params?: null; modules?: string[] | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const { width, height, steps, cfg, sampler, scheduler } = form;
  const current: ModelParams = { width, height, steps, cfg, sampler, scheduler };

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <button className="flex w-full items-center gap-2 px-3 py-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="text-sm font-semibold">{family ?? "ベースモデル不明"}</span>
        <span className="text-[11px] text-muted">{titles.length} モデル</span>
        {base.modules.length > 0 && <span className="rounded-full bg-surface2 px-2 py-0.5 text-[10px] text-muted">TE / VAE {base.modules.length}</span>}
        <span className={`ml-auto text-muted transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-line p-3">
          {family ? (
            <>
              <section>
                <Row label="既定のパラメータ" note={base.custom.params ? "変更済み" : base.params ? "組み込み" : null} />
                <p className="mb-2 font-mono text-xs text-muted">{base.params ? summary(base.params) : "なし (生成画面の値のまま)"}</p>
                <div className="flex flex-wrap gap-2">
                  <SmallButton onClick={() => onBase({ params: current })}>今の生成画面の値にする</SmallButton>
                  {base.custom.params && <SmallButton onClick={() => onBase({ params: null })}>組み込みに戻す</SmallButton>}
                </div>
                <p className="mt-1 text-[11px] text-muted">今の値: {summary(current)}</p>
              </section>

              <section>
                <Row label="Text Encoder / VAE" note={base.custom.modules ? "変更済み" : base.modules.length ? "組み込み" : null} info={modulesInfo} />
                <ModuleList selected={base.modules} modules={modules} empty="指定なし (Checkpoint に入っているものを使う)" />
                <div className="mt-2 flex flex-wrap gap-2">
                  <SmallButton onClick={() => setPicking(!picking)}>{picking ? "閉じる" : "選ぶ"}</SmallButton>
                  {base.custom.modules && <SmallButton onClick={() => onBase({ modules: null })}>組み込みに戻す</SmallButton>}
                </div>
                {picking && <ModulePicker selected={base.modules} modules={modules} onChange={(m) => onBase({ modules: m })} />}
              </section>
            </>
          ) : (
            <p className="text-xs text-muted">ベースモデルが分からないモデルは、ベースモデルの既定を使えません (モデルごとの設定だけ)</p>
          )}

          {titles.length > 0 && (
            <section>
              <Row label="モデルごとの設定" />
              <ul className="space-y-2">
                {titles.map((t) => (
                  <ModelRow key={t} title={t} params={prefs.modelParams[t]} own={prefs.modelModules[t]} base={base} modules={modules} onChange={(patch) => onModel(t, patch)} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ModelRow({
  title,
  params,
  own,
  base,
  modules,
  onChange,
}: {
  title: string;
  params: ModelParams | undefined;
  own: string[] | undefined;
  base: BaseSettings;
  modules: ForgeModule[] | null;
  onChange: (patch: { params?: null; modules?: string[] | null }) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <li className="rounded-xl border border-line bg-bg/40 p-2.5">
      <div className="truncate text-xs font-semibold">{modelLabel(title)}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate font-mono">{params ? `前回: ${summary(params)}` : "前回の値なし (ベースモデルの既定)"}</span>
        {params && (
          <button className="flex-none text-accent" onClick={() => onChange({ params: null })}>
            忘れる
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
        <span className="min-w-0 flex-1">{own ? "TE / VAE: 個別に指定" : "TE / VAE: ベースモデルと同じ"}</span>
        <button className="flex-none text-accent" onClick={() => setPicking(!picking)}>
          {picking ? "閉じる" : own ? "変える" : "個別に指定"}
        </button>
        {own && (
          <button
            className="flex-none text-accent"
            onClick={() => {
              setPicking(false);
              onChange({ modules: null });
            }}
          >
            ベースに戻す
          </button>
        )}
      </div>
      {own && <ModuleList selected={own} modules={modules} empty="指定なし (Checkpoint に入っているものを使う)" />}
      {picking && <ModulePicker selected={own ?? base.modules} modules={modules} onChange={(m) => onChange({ modules: m })} />}
    </li>
  );
}

/** 選んでいる TE / VAE。Forge に無いものは赤くする */
function ModuleList({ selected, modules, empty }: { selected: string[]; modules: ForgeModule[] | null; empty: string }) {
  if (!selected.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <ul className="space-y-0.5">
      {selected.map((name) => {
        const m = modules?.find((x) => x.name === name);
        const missing = modules && !m;
        return (
          <li key={name} className={`font-mono text-xs break-all ${missing ? "text-danger" : ""}`}>
            {name}
            <span className="ml-1.5 text-[10px] text-muted">{missing ? "Forge にありません" : m?.folder}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Forge の models/VAE・models/text_encoder にあるファイルから選ぶ (複数可) */
function ModulePicker({ selected, modules, onChange }: { selected: string[]; modules: ForgeModule[] | null; onChange: (m: string[]) => void }) {
  if (!modules) return <p className="mt-2 text-xs text-muted">読み込み中…</p>;
  const folders = [...new Set(modules.map((m) => m.folder))].sort();
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-line p-2">
      {folders.map((f) => (
        <div key={f}>
          <div className="mb-1 text-[10px] tracking-wider text-muted uppercase">{f}</div>
          {modules
            .filter((m) => m.folder === f)
            .map((m) => {
              const on = selected.includes(m.name);
              return (
                <label key={m.name} className="flex items-center gap-2 py-1 text-xs">
                  <input type="checkbox" checked={on} onChange={() => onChange(on ? selected.filter((x) => x !== m.name) : [...selected, m.name])} />
                  <span className="break-all">{m.name}</span>
                </label>
              );
            })}
        </div>
      ))}
      {modules.length === 0 && <p className="text-xs text-muted">models/VAE と models/text_encoder にファイルがありません</p>}
    </div>
  );
}

const modulesInfo =
  "一覧は Forge が models/VAE と models/text_encoder から作ったものです。Forge は起動したときにしか一覧を読み直さないので、ファイルを置いたのに一覧に無ければ Forge を再起動してください (Extras の「Forge 起動・診断」から)";

/** 小見出し。info があれば (i) を押したときだけ説明を出す */
function Row({ label, note, info }: { label: string; note?: string | null; info?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1">
      <div className="flex items-center gap-2 text-[11px] tracking-wider text-muted uppercase">
        {label}
        {info && (
          <button onClick={() => setOpen((v) => !v)} aria-label="説明" className={`text-xs ${open ? "text-accent" : "text-muted"}`}>
            <FontAwesomeIcon icon={faCircleInfo} />
          </button>
        )}
        {note && <span className="rounded-full bg-surface2 px-1.5 py-0.5 text-[10px] tracking-normal normal-case">{note}</span>}
      </div>
      {open && <p className="mt-1.5 rounded-lg bg-surface2 px-3 py-2 text-xs leading-relaxed whitespace-pre-line">{info}</p>}
    </div>
  );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-line px-3 py-1 text-xs text-accent">
      {children}
    </button>
  );
}
