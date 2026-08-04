import { describe, it, expect } from 'vitest';
import { MetricsRegistry } from '../metrics/registry.js';

describe('MetricsRegistry', () => {
  it('renders counters with labels', () => {
    const registry = new MetricsRegistry();
    registry.incrementCounter('http_requests_total', { method: 'GET', status: '200' });
    registry.incrementCounter('http_requests_total', { method: 'GET', status: '200' });
    registry.incrementCounter('http_requests_total', { method: 'POST', status: '500' });

    const out = registry.snapshot();
    expect(out).toContain('# TYPE http_requests_total counter');
    expect(out).toContain('http_requests_total{method="GET",status="200"} 2');
    expect(out).toContain('http_requests_total{method="POST",status="500"} 1');
  });

  it('renders gauges and unlabeled metrics without braces', () => {
    const registry = new MetricsRegistry();
    registry.setGauge('bothive_bots_total', 3);

    const out = registry.snapshot();
    expect(out).toContain('# TYPE bothive_bots_total gauge');
    expect(out).toContain('bothive_bots_total 3');
  });

  it('renders histograms with buckets, sum and count', () => {
    const registry = new MetricsRegistry();
    registry.observe('http_request_duration_seconds', 0.05);
    registry.observe('http_request_duration_seconds', 0.3);

    const out = registry.snapshot();
    expect(out).toContain('# TYPE http_request_duration_seconds histogram');
    expect(out).toContain('http_request_duration_seconds_bucket{le="0.05"} 1');
    expect(out).toContain('http_request_duration_seconds_bucket{le="+Inf"} 2');
    expect(out).toContain('http_request_duration_seconds_sum 0.35');
    expect(out).toContain('http_request_duration_seconds_count 2');
  });

  it('distinguishes same-name metrics by labels', () => {
    const registry = new MetricsRegistry();
    registry.setGauge('bothive_bots_total', 1);
    registry.setGauge('bothive_bots_total', 5);
    const out = registry.snapshot();
    expect(out).toContain('bothive_bots_total 5');
  });

  it('escapes and strips malicious label values', () => {
    const registry = new MetricsRegistry();
    const evil = 'x\n# TYPE http_requests_total counter\nhttp_requests_total 999';
    registry.incrementCounter('http_requests_total', { route: evil });
    const out = registry.snapshot();
    // the injected metric line must not materialize
    expect(out).not.toMatch(/^http_requests_total 999$/m);
    // newline is neutralized inside the label value
    expect(out).toContain('route="x # TYPE http_requests_total counter');
  });

  it('handles metric names containing colons safely', () => {
    const registry = new MetricsRegistry();
    registry.setGauge('ns:metric_name', 7);
    const out = registry.snapshot();
    expect(out).toContain('# TYPE ns:metric_name gauge');
    expect(out).toContain('ns:metric_name 7');
  });
});
