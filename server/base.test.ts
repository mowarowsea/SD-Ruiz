import { describe, expect, it } from "vitest";
import { archNeedsModules, archOf, builtinBaseSettings, familyOf } from "./base.js";

describe("familyOf", () => {
  it("Civitai のベースモデル名を設定の単位にそろえる", () => {
    expect(familyOf("Illustrious")).toBe("Illustrious");
    expect(familyOf("Illustrious XL v1.0")).toBe("Illustrious");
    expect(familyOf("NoobAI")).toBe("NoobAI");
    expect(familyOf("Pony")).toBe("Pony");
    expect(familyOf("SDXL 1.0")).toBe("SDXL");
    expect(familyOf("SD 1.5")).toBe("SD 1.5");
    expect(familyOf("SD1.5")).toBe("SD 1.5");
    expect(familyOf("SD 2.1 768")).toBe("SD 2");
    expect(familyOf("SD 3.5 Large")).toBe("SD 3");
    expect(familyOf("Flux.1 D")).toBe("Flux");
    expect(familyOf("Anima")).toBe("Anima");
  });

  it("Illustrious / Pony は SDXL と書いてあっても固有の名前を優先する", () => {
    expect(familyOf("SDXL Illustrious")).toBe("Illustrious");
    expect(familyOf("Pony (SDXL)")).toBe("Pony");
  });

  it("分からなければ null、知らない名前はそのまま", () => {
    expect(familyOf(null)).toBeNull();
    expect(familyOf("")).toBeNull();
    expect(familyOf("Kolors")).toBe("Kolors");
  });
});

describe("archOf", () => {
  it("SDXL 系はどれも sdxl (LoRA を共有できる)", () => {
    for (const f of ["Illustrious", "NoobAI", "Pony", "SDXL"]) expect(archOf(f)).toBe("sdxl");
  });

  it("そのほかの系統と、分からないもの", () => {
    expect(archOf("SD 1.5")).toBe("sd1");
    expect(archOf("SD 2")).toBe("sd2");
    expect(archOf("SD 3")).toBe("sd3");
    expect(archOf("Flux")).toBe("flux");
    expect(archOf("Anima")).toBe("anima");
    expect(archOf("Kolors")).toBeNull();
    expect(archOf(null)).toBeNull();
  });
});

describe("組み込みの既定", () => {
  it("Anima は TE / VAE が要り、既定のパラメータとモジュールがある", () => {
    expect(archNeedsModules.has("anima")).toBe(true);
    expect(builtinBaseSettings.Anima.modules.length).toBeGreaterThan(0);
    expect(builtinBaseSettings.Anima.params).not.toBeNull();
  });
});
