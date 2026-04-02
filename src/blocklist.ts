import fs from "node:fs";

export class Blocklist {
  private readonly blockEntries: string[];
  private readonly allowEntries: string[];

  constructor(blocklistPath: string | null, allowlistPath: string | null) {
    this.blockEntries = Blocklist.loadEntries(blocklistPath);
    this.allowEntries = Blocklist.loadEntries(allowlistPath);
  }

  blocked(domain: string): boolean {
    const normalized = Blocklist.normalize(domain);
    if (!normalized) return false;
    if (this.matchAny(this.allowEntries, normalized)) return false;
    return this.matchAny(this.blockEntries, normalized);
  }

  private static loadEntries(path: string | null): string[] {
    if (!path || !fs.existsSync(path)) return [];
    return fs
      .readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"))
      .map((l) => Blocklist.normalize(l))
      .filter((l): l is string => !!l)
      .filter((v, i, a) => a.indexOf(v) === i);
  }

  private static normalize(name: string): string {
    return name.toLowerCase().replace(/\.+$/, "");
  }

  private matchAny(entries: string[], domain: string): boolean {
    return entries.some((e) => domain === e || domain.endsWith(`.${e}`));
  }
}
