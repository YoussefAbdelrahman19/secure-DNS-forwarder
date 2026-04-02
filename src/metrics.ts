type Labels = Record<string, string>;

function normLabels(labels: Labels): Labels {
  return Object.fromEntries(
    Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function labelKey(labels: Labels): string {
  return JSON.stringify(normLabels(labels));
}

function fmtLabels(labels: Labels): string {
  const n = normLabels(labels);
  const keys = Object.keys(n);
  if (keys.length === 0) return "";
  const content = keys.map((k) => `${k}="${n[k]}"`).join(",");
  return `{${content}}`;
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, { sum: number; count: number }>();

  private cKey(name: string, labels: Labels): string {
    return `${name}\0${labelKey(labels)}`;
  }

  increment(name: string, labels: Labels = {}, by = 1): void {
    const key = this.cKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    const key = this.cKey(name, labels);
    const h = this.histograms.get(key) ?? { sum: 0, count: 0 };
    h.sum += value;
    h.count += 1;
    this.histograms.set(key, h);
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    const nameFromKey = (k: string) => k.split("\0")[0];
    const labelsFromKey = (k: string): Labels => {
      const raw = k.split("\0")[1];
      return raw ? (JSON.parse(raw) as Labels) : {};
    };

    for (const [key, value] of this.counters) {
      const name = nameFromKey(key);
      lines.push(`${name}${fmtLabels(labelsFromKey(key))} ${value}`);
    }
    for (const [key, payload] of this.histograms) {
      const name = nameFromKey(key);
      const lb = fmtLabels(labelsFromKey(key));
      lines.push(`${name}_sum${lb} ${payload.sum}`);
      lines.push(`${name}_count${lb} ${payload.count}`);
    }
    return lines.join("\n") + "\n";
  }
}
