import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// data/translations.csv (自分で直した訳) は本物に触らず、メモリ上に持つ
const mem = await vi.hoisted(async () => (await import("./test-fs.js")).memoryFs((p) => /[\\/]data([\\/]translations\.csv)?$/.test(p)));
vi.mock("node:fs", async (orig) => mem.fake(await orig()));

import { TagDictionary, tagKey } from "./dictionary.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ruiz-dict-"));
  // tagcomplete の danbooru.csv と同じ形 (件数の多い順)
  writeFileSync(join(dir, "danbooru.csv"), ['1girl,0,5000000,"1girls,sole_female"', "blue_hair,0,900000,", "blue_eyes,0,800000,", "hatsune_miku,4,100000,miku", "hair_ornament,0,70000,", "artist_x,1,10,"].join("\r\n"));
  writeFileSync(join(dir, "jp.csv"), ["1girl,女の子1人", "blue_hair,青髪", "hatsune_miku,初音ミク", "unknown_tag,未知"].join("\n"));
  writeFileSync(join(dir, "jp2.csv"), 'blue_hair,"青い髪"\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => mem.reset());

const make = () => new TagDictionary(dir, "danbooru.csv", ["jp.csv", "missing.csv", "jp2.csv"]);

describe("TagDictionary", () => {
  test("CSV を読む。訳は後ろのファイルが優先。無いファイルは飛ばす", () => {
    const d = make();
    expect(d.size).toBe(6);
    expect(d.translationCount).toBe(4);
    expect(d.lookup(["blue_hair"])[0].translation).toBe("青い髪");
    expect(new TagDictionary(null, "danbooru.csv", null).size).toBe(0);
  });

  test("search: 前方一致 → 別名の前方一致 → (3 文字以上なら) 部分一致、件数順", () => {
    const d = make();
    expect(d.search("blue").map((t) => t.name)).toEqual(["blue_hair", "blue_eyes"]);
    expect(d.search("sole")).toEqual([{ name: "1girl", category: 0, count: 5000000, alias: "sole_female", translation: "女の子1人" }]);
    expect(d.search("air").map((t) => t.name)).toEqual(["blue_hair", "hair_ornament"]);
    expect(d.search("ha").map((t) => t.name)).toEqual(["hatsune_miku", "hair_ornament"]);
    expect(d.search("Blue Hair").map((t) => t.name)).toEqual(["blue_hair"]);
    expect(d.search("blue", 1)).toHaveLength(1);
    expect(d.search("")).toEqual([]);
  });

  test("search: 日本語なら訳から引く (前方一致 → 部分一致)。タグ CSV に無い語は unknown", () => {
    const d = make();
    expect(d.search("青").map((t) => t.name)).toEqual(["blue_hair"]);
    expect(d.search("ミク").map((t) => t.name)).toEqual(["hatsune_miku"]);
    expect(d.search("未知")[0]).toMatchObject({ name: "unknown_tag", unknown: true, translation: "未知" });
  });

  test("lookup: 別名は元のタグにし、無い語も unknown として返す", () => {
    const d = make();
    expect(d.lookup(["1girl", "Blue Hair", "miku", "nope"])).toEqual([
      { name: "1girl", category: 0, count: 5000000, translation: "女の子1人" },
      { name: "blue_hair", category: 0, count: 900000, translation: "青い髪" },
      { name: "hatsune_miku", category: 4, count: 100000, alias: "miku", translation: "初音ミク" },
      { name: "nope", category: 0, count: 0, unknown: true },
    ]);
  });

  test("translations: タグ名か訳の部分一致。絞らなければ件数順に limit 件", () => {
    const d = make();
    expect(d.translations("青", false).map((t) => t.name)).toEqual(["blue_hair"]);
    expect(d.translations("miku", false).map((t) => t.name)).toEqual(["hatsune_miku"]);
    expect(d.translations("", false).map((t) => t.name)).toEqual(["1girl", "blue_hair", "hatsune_miku", "unknown_tag"]);
    expect(d.translations("", false, 2).map((t) => t.name)).toEqual(["1girl", "blue_hair"]);
    expect(d.translations("", true)).toEqual([]);
  });

  test("setTranslation: 自分の訳は辞書より優先し、data/translations.csv に名前順で保存する。空で消す", () => {
    const d = make();
    expect(d.setTranslation("Blue Hair", "あおい かみ\n")).toMatchObject({ name: "blue_hair", translation: "あおい かみ", edited: true });
    d.setTranslation("zz_new", "新しい語");
    expect(d.translations("", true).map((t) => t.name)).toEqual(["blue_hair", "zz_new"]);
    expect(d.translations("", true)[1]).toMatchObject({ unknown: true, edited: true });
    const file = [...mem.files.keys()].find((k) => k.endsWith("translations.csv"))!;
    expect(mem.text(file)).toBe("blue_hair,あおい かみ\nzz_new,新しい語\n");
    expect(d.search("あおい").map((t) => t.name)).toEqual(["blue_hair"]);

    expect(d.setTranslation("blue_hair", "")).toMatchObject({ translation: "青い髪" });
    expect(d.translations("", true).map((t) => t.name)).toEqual(["zz_new"]);
    expect(() => d.setTranslation("a,b", "x")).toThrow(/タグ名/);
  });

  test("自分の訳は次に作ったときにも読める", () => {
    make().setTranslation("hatsune_miku", "ミクさん");
    expect(make().lookup(["hatsune_miku"])[0]).toMatchObject({ translation: "ミクさん", edited: true });
  });

  test("tagKey は小文字・空白を _ に", () => {
    expect(tagKey(" Blue  Hair ")).toBe("blue_hair");
  });
});
