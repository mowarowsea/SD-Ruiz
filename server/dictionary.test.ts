import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TagDictionary, tagKey } from "./dictionary.js";
import { tempDir } from "./testing/tmp.js";

let tmp: ReturnType<typeof tempDir>;
let tagsDir: string;
let userPath: string;

// 件数の多い順 (tagcomplete の CSV と同じ並び)
const tagCsv = [
  '1girl,0,5000000,"1girls,sole_female"',
  "long_hair,0,4000000,",
  "blue_eyes,0,2000000,",
  "blue_hair,0,1000000,",
  'hatsune_miku,4,100000,"miku"',
  "blue_sky,0,50000,",
  "",
].join("\n");

beforeEach(() => {
  tmp = tempDir();
  tagsDir = join(tmp.dir, "tags");
  mkdirSync(tagsDir);
  userPath = join(tmp.dir, "data", "translations.csv");
  writeFileSync(join(tagsDir, "danbooru.csv"), tagCsv);
  writeFileSync(join(tagsDir, "machine-jp.csv"), "1girl,女の子1人\nblue_hair,青髪\nlong_hair,長髪\nmy_custom_tag,独自のタグ\n");
  writeFileSync(join(tagsDir, "jp.csv"), 'blue_hair,"青い髪"\n');
});
afterEach(() => tmp.remove());

const dict = () => new TagDictionary(tagsDir, "danbooru.csv", ["machine-jp.csv", "jp.csv", "missing.csv"], userPath);

describe("tagKey", () => {
  it("小文字にして空白を _ にする", () => {
    expect(tagKey(" Blue  Hair ")).toBe("blue_hair");
  });
});

describe("TagDictionary", () => {
  it("タグ CSV と訳 CSV を読む (後ろの訳ファイルが優先、無いファイルは飛ばす)", () => {
    const d = dict();
    expect(d.size).toBe(6);
    expect(d.translationCount).toBe(4);
    expect(d.lookup(["blue_hair"])[0].translation).toBe("青い髪");
  });

  it("tagsDir が無ければ空 (補完なし)", () => {
    const d = new TagDictionary(null, "danbooru.csv", [], userPath);
    expect(d.size).toBe(0);
    expect(d.search("blue")).toEqual([]);
  });

  describe("search", () => {
    it("前方一致 → 別名の前方一致 → 部分一致の順に、それぞれ件数の多い順", () => {
      const names = dict()
        .search("blue")
        .map((h) => h.name);
      expect(names).toEqual(["blue_eyes", "blue_hair", "blue_sky"]);
    });

    it("別名で当たったものは alias を付ける", () => {
      const [hit] = dict().search("miku");
      expect(hit).toMatchObject({ name: "hatsune_miku", alias: "miku", category: 4 });
    });

    it("部分一致は 3 文字から", () => {
      expect(dict().search("air").map((h) => h.name)).toEqual(["long_hair", "blue_hair"]);
      expect(dict().search("ai")).toEqual([]);
    });

    it("空白は _ として比べ、limit で切る", () => {
      expect(dict().search("blue hair")[0].name).toBe("blue_hair");
      expect(dict().search("blue", 2).map((h) => h.name)).toEqual(["blue_eyes", "blue_hair"]);
    });

    it("日本語なら訳から引く (前方一致 → 部分一致、タグに無いものは unknown)", () => {
      const hits = dict().search("青");
      expect(hits.map((h) => h.name)).toEqual(["blue_hair"]);
      expect(dict().search("独自")[0]).toMatchObject({ name: "my_custom_tag", unknown: true });
      expect(dict().search("髪").map((h) => h.name)).toEqual(["long_hair", "blue_hair"]);
    });
  });

  describe("lookup", () => {
    it("別名は元のタグにし、無い語は unknown", () => {
      const [a, b, c] = dict().lookup(["1girls", "Blue Hair", "nonexistent"]);
      expect(a).toMatchObject({ name: "1girl", alias: "1girls", translation: "女の子1人" });
      expect(b).toMatchObject({ name: "blue_hair", translation: "青い髪" });
      expect(c).toMatchObject({ name: "nonexistent", unknown: true, count: 0 });
      expect(c.translation).toBeUndefined();
    });
  });

  describe("setTranslation", () => {
    it("自分の訳は配布の訳より優先し、ファイルに名前順で保存し、次に開いたときも効く", () => {
      const d = dict();
      expect(d.setTranslation("Blue Hair", "あおかみ")).toMatchObject({ name: "blue_hair", translation: "あおかみ", edited: true });
      d.setTranslation("1girl", "少女");
      expect(readFileSync(userPath, "utf8")).toBe("1girl,少女\nblue_hair,あおかみ\n");
      expect(dict().lookup(["blue_hair"])[0]).toMatchObject({ translation: "あおかみ", edited: true });
    });

    it("空にすると自分の訳を消して配布の訳に戻る", () => {
      const d = dict();
      d.setTranslation("blue_hair", "あおかみ");
      expect(d.setTranslation("blue_hair", " ")).toMatchObject({ translation: "青い髪" });
      expect(d.lookup(["blue_hair"])[0].edited).toBeUndefined();
      expect(readFileSync(userPath, "utf8")).toBe("");
    });

    it("改行は空白にし、おかしい名前は 400", () => {
      const d = dict();
      expect(d.setTranslation("blue_hair", "青い\n髪").translation).toBe("青い 髪");
      expect(() => d.setTranslation("", "x")).toThrow(expect.objectContaining({ statusCode: 400 }));
      expect(() => d.setTranslation("a,b", "x")).toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it("自分で訳を付けた語は、別名であっても元のタグに寄せない", () => {
      const d = dict();
      d.setTranslation("miku", "ミク");
      expect(d.lookup(["miku"])[0]).toMatchObject({ name: "miku", unknown: true, translation: "ミク" });
    });
  });

  describe("translations (一覧)", () => {
    it("件数の多い順。タグ名か訳の部分一致で絞り、edited なら直したものだけ", () => {
      const d = dict();
      expect(d.translations("", false).map((h) => h.name)).toEqual(["1girl", "long_hair", "blue_hair", "my_custom_tag"]);
      expect(d.translations("髪", false).map((h) => h.name)).toEqual(["long_hair", "blue_hair"]);
      expect(d.translations("hair", false, 1).map((h) => h.name)).toEqual(["long_hair"]);
      d.setTranslation("blue_sky", "青空");
      expect(d.translations("", true).map((h) => h.name)).toEqual(["blue_sky"]);
      expect(d.translationCount).toBe(5);
    });
  });
});
