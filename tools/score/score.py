# ベンチマークの画像を WD14 tagger で採点する (tools/bench.ts から呼ぶ。単体でも動く)。
#
#   tools/score/.venv/Scripts/python.exe tools/score/score.py <bench の出力 dir>
#
# 画像から Danbooru のタグを推定し、プロンプトのタグと突き合わせる:
#   Positive 一致率: プロンプトのタグのうち、画像に出ている (確率 >= しきい値) ものの割合
#   Negative 混入率: Negative のタグのうち、画像に出てしまっているものの割合
# tagger の語彙に無い言葉 ("85mm lens" など) は数えない。
# プロンプトは先頭の variant (ふつうはベースライン) の画像の生成情報から読み、全 variant 共通で使う
# (variant が足した LoRA などで採点の基準がずれないように)。
# 結果は <dir>/scores.json。CPU で動くので Forge と VRAM を取り合わない。
# 準備: python -m venv tools/score/.venv && tools/score/.venv/Scripts/python.exe -m pip install -r tools/score/requirements.txt
# (初回はモデル 1.2GB を HuggingFace から落とす)
# tagger はアニメ絵で学習しているので、実写寄りの絵では表情・ポーズのタグを拾いにくい。絶対値より variant 同士の差を見る

import csv
import json
import re
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from PIL import Image

REPO = "SmilingWolf/wd-eva02-large-tagger-v3"
THRESHOLD = 0.35


def load_model():
    model = hf_hub_download(REPO, "model.onnx")
    labels = hf_hub_download(REPO, "selected_tags.csv")
    with open(labels, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    # rating (category 9) は除く。general (0) と character (4) だけ
    names = [r["name"].replace("_", " ") for r in rows]
    use = [r["category"] != "9" for r in rows]
    session = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    return session, names, use


def predict(session, path: Path) -> np.ndarray:
    size = session.get_inputs()[0].shape[1]
    img = Image.open(path).convert("RGBA")
    # 透明部分と余白は白で埋めて正方形にする (tagger の学習時と同じ)
    canvas = Image.new("RGBA", img.size, (255, 255, 255, 255))
    canvas.alpha_composite(img)
    img = canvas.convert("RGB")
    side = max(img.size)
    square = Image.new("RGB", (side, side), (255, 255, 255))
    square.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    square = square.resize((size, size), Image.BICUBIC)
    x = np.asarray(square, dtype=np.float32)[:, :, ::-1]  # RGB -> BGR
    return session.run(None, {session.get_inputs()[0].name: x[None]})[0][0]


def read_infotext(path: Path) -> tuple[str, str]:
    text = Image.open(path).info.get("parameters", "")
    lines = text.strip().split("\n")
    if lines and lines[-1].lstrip().startswith("Steps:"):
        lines.pop()
    body = "\n".join(lines)
    m = re.search(r"^Negative prompt:", body, re.M)
    if not m:
        return body, ""
    return body[: m.start()], body[m.end() :]


def prompt_tags(text: str, vocab: dict[str, int]) -> set[int]:
    text = re.sub(r"<[^>]*>", ",", text)  # LoRA
    text = text.replace("\\(", "\0").replace("\\)", "\1")  # エスケープした括弧はタグの一部
    out = set()
    for part in re.split(r"[,\n|]", text):
        t = re.sub(r"[()\[\]{}]", "", part)
        t = re.sub(r":\s*[\d.]+\s*$", "", t)  # (tag:1.2) の重み
        t = t.replace("\0", "(").replace("\1", ")").replace("_", " ").strip().lower()
        t = re.sub(r"\s+", " ", t)
        if t in vocab:
            out.add(vocab[t])
    return out


def main():
    out_dir = Path(sys.argv[1])
    results = json.loads((out_dir / "results.json").read_text(encoding="utf-8"))
    session, names, use = load_model()
    vocab = {n: i for i, n in enumerate(names) if use[i]}

    base_runs = results[0]["runs"]
    prompts = []
    for r in base_runs:
        pos, neg = read_infotext(out_dir / r["file"])
        prompts.append((prompt_tags(pos, vocab), prompt_tags(neg, vocab)))

    scores = []
    for res in results:
        images = []
        for r, (pos, neg) in zip(res["runs"], prompts):
            probs = predict(session, out_dir / r["file"])
            hit = lambda i: bool(probs[i] >= THRESHOLD)
            images.append(
                {
                    "file": r["file"],
                    "posMatched": sorted(names[i] for i in pos if hit(i)),
                    "posMissed": sorted(names[i] for i in pos if not hit(i)),
                    "negHit": sorted(names[i] for i in neg if hit(i)),
                    "posCount": len(pos),
                    "negCount": len(neg),
                    "posMeanProb": float(np.mean([probs[i] for i in pos])) if pos else None,
                }
            )
        pos_total = sum(i["posCount"] for i in images)
        neg_total = sum(i["negCount"] for i in images)
        scores.append(
            {
                "variant": res["variant"]["name"],
                "posRecall": sum(len(i["posMatched"]) for i in images) / pos_total if pos_total else None,
                "posMeanProb": float(np.mean([i["posMeanProb"] for i in images if i["posMeanProb"] is not None])) if pos_total else None,
                "negHitRate": sum(len(i["negHit"]) for i in images) / neg_total if neg_total else None,
                "images": images,
            }
        )
        print(f"{res['variant']['name']}: Positive {scores[-1]['posRecall']:.3f} / Negative {scores[-1]['negHitRate']:.3f}", file=sys.stderr)

    (out_dir / "scores.json").write_text(json.dumps({"threshold": THRESHOLD, "model": REPO, "variants": scores}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
