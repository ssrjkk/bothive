interface HistogramBucket {
  le: number;
  count: number;
  sum: number;
}

interface MetricEntry<T> {
  name: string;
  value: T;
  help: string;
  labels?: Record<string, string>;
}

const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const KEY_SEPARATOR = '\u0000';

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\u0000-\u001f\u007f]/g, ' ');
}

export class MetricsRegistry {
  private counters = new Map<string, MetricEntry<number>>();
  private gauges = new Map<string, MetricEntry<number>>();
  private histograms = new Map<string, MetricEntry<Map<string, HistogramBucket>>>();

  private static key(name: string, labels?: Record<string, string>): string {
    return `${name}${KEY_SEPARATOR}${JSON.stringify(labels ?? {})}`;
  }

  incrementCounter(name: string, labels?: Record<string, string>, by: number = 1): void {
    const key = MetricsRegistry.key(name, labels);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += by;
    } else {
      this.counters.set(key, { name, value: by, help: name, labels });
    }
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    this.gauges.set(MetricsRegistry.key(name, labels), { name, value, help: name, labels });
  }

  observe(name: string, value: number, labels?: Record<string, string>): void {
    const key = MetricsRegistry.key(name, labels);
    let entry = this.histograms.get(key);
    if (!entry) {
      const bucketMap = new Map<string, HistogramBucket>();
      for (const le of HISTOGRAM_BUCKETS) bucketMap.set(String(le), { le, count: 0, sum: 0 });
      entry = { name, value: bucketMap, help: name, labels };
      this.histograms.set(key, entry);
    }
    for (const bucket of entry.value.values()) {
      if (value <= bucket.le) bucket.count += 1;
      bucket.sum += value;
    }
  }

  private static formatLabels(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return '';
    const inner = Object.entries(labels)
      .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
      .join(',');
    return `{${inner}}`;
  }

  snapshot(): string {
    const lines: string[] = [];

    for (const metric of this.counters.values()) {
      const name = metric.name;
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}${MetricsRegistry.formatLabels(metric.labels)} ${metric.value}`);
    }

    for (const metric of this.gauges.values()) {
      const name = metric.name;
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${MetricsRegistry.formatLabels(metric.labels)} ${metric.value}`);
    }

    for (const metric of this.histograms.values()) {
      const name = metric.name;
      const baseLabels = metric.labels ?? {};
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} histogram`);
      const sorted = [...metric.value.values()].sort((a, b) => a.le - b.le);
      let count = 0;
      let sum = 0;
      for (const bucket of sorted) {
        const labels = { ...baseLabels, le: String(bucket.le) };
        lines.push(`${name}_bucket${MetricsRegistry.formatLabels(labels)} ${bucket.count}`);
        count = bucket.count;
        sum = bucket.sum;
      }
      lines.push(`${name}_bucket${MetricsRegistry.formatLabels({ ...baseLabels, le: '+Inf' })} ${count}`);
      lines.push(`${name}_sum${MetricsRegistry.formatLabels(baseLabels)} ${sum}`);
      lines.push(`${name}_count${MetricsRegistry.formatLabels(baseLabels)} ${count}`);
    }

    return lines.join('\n');
  }
}
