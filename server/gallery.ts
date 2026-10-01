// ギャラリー: Forge 内で動いている Infinite Image Browsing (IIB) の API を中継する。
// IIB の内部 API なので、IIB の更新で形が変わったらここを直す

import { ForgeError } from "./forge.js";

export interface GalleryFile {
  path: string;
  name: string;
  /** "2026-10-01 10:43:23" */
  date: string;
  bytes: number;
}

export interface GalleryTag {
  id: number;
  name: string;
  /** custom (Like など手で付けるタグ) / Model */
  type: string;
  count: number;
}

interface IibFile {
  type: string;
  name: string;
  fullpath: string;
  date: string;
  bytes: number;
}

interface IibPage {
  files: IibFile[];
  cursor: { has_next: boolean; next: string };
}

export class Gallery {
  private readonly base: string;
  private folders: string[] | null;

  constructor(forgeUrl: string, folders: string[] | null) {
    this.base = `${forgeUrl}/infinite_image_browsing`;
    this.folders = folders;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { signal: AbortSignal.timeout(60_000), ...init });
    } catch (e) {
      throw new ForgeError(`IIB に接続できません: ${(e as Error).message}`);
    }
    if (!res.ok) throw new ForgeError(`IIB が ${res.status} を返しました: ${path} ${(await res.text().catch(() => "")).slice(0, 300)}`, res.status);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private post<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  /** 表示するフォルダ。設定が無ければ IIB に登録されている追加パスのうち grid 以外を使う */
  async galleryFolders(): Promise<string[]> {
    if (this.folders) return this.folders;
    const s = await this.request<{ extra_paths: { path: string }[] }>("/global_setting");
    this.folders = s.extra_paths.map((p) => p.path).filter((p) => !/grid/i.test(p));
    return this.folders;
  }

  /** 新しく保存された画像を IIB の索引に取り込ませる (更新されたフォルダだけ走査される) */
  async refreshIndex() {
    await this.post("/db/update_image_data", {});
  }

  /** 新しい順に 1 ページ分。タグ指定があればタグ (AND) で、無ければプロンプトなどの部分一致で探す */
  async list(opts: { cursor?: string; query?: string; tagIds?: number[]; size?: number }): Promise<{ files: GalleryFile[]; next: string | null }> {
    const folder_paths = await this.galleryFolders();
    const size = opts.size ?? 120;
    const page = opts.tagIds?.length
      ? await this.post<IibPage>("/db/match_images_by_tags", { and_tags: opts.tagIds, cursor: opts.cursor ?? "", folder_paths, size })
      : await this.post<IibPage>("/db/search_by_substr", { surstr: opts.query ?? "", cursor: opts.cursor ?? "", folder_paths, size, media_type: "image" });
    return {
      files: page.files.filter((f) => f.type === "file").map((f) => ({ path: f.fullpath, name: f.name, date: f.date, bytes: f.bytes })),
      next: page.cursor.has_next ? page.cursor.next : null,
    };
  }

  /** 絞り込みに使うタグ (手で付けるタグとモデル) */
  async tags(): Promise<GalleryTag[]> {
    const info = await this.request<{ tags: GalleryTag[] }>("/db/basic_info");
    return info.tags.filter((t) => t.type === "custom" || t.type === "Model").map(({ id, name, type, count }) => ({ id, name, type, count }));
  }

  async info(path: string) {
    const q = `path=${encodeURIComponent(path)}`;
    const [geninfo, tags] = await Promise.all([this.request<string>(`/image_geninfo?${q}`), this.request<GalleryTag[]>(`/db/img_selected_custom_tag?${q}`)]);
    return { geninfo: geninfo ?? "", tags: tags.map(({ id, name, type, count }) => ({ id, name, type, count })) };
  }

  async toggleTag(path: string, tagId: number) {
    return this.post<{ is_remove: number }>("/db/toggle_custom_tag_to_img", { img_path: path, tag_id: tagId });
  }

  /** ファイルごと削除する (IIB の削除はごみ箱を経由しない) */
  async remove(path: string) {
    await this.post("/delete_files", { file_paths: [path] });
  }

  /** サムネイル / 元画像をそのまま流す */
  fetchImage(path: string, date: string, thumb: boolean) {
    const q = `path=${encodeURIComponent(path)}&t=${encodeURIComponent(date)}`;
    return fetch(`${this.base}${thumb ? `/image-thumbnail?${q}&size=512x512` : `/file?${q}`}`);
  }
}
