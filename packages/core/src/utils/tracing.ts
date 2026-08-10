import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { registerInstrumentations, type Instrumentation } from '@opentelemetry/instrumentation';

export interface TracingOptions {
  /** Value for the `service.name` resource attribute, e.g. `bothive-api`. */
  serviceName: string;
  serviceVersion?: string;
  /** Node instrumentations to register after the provider starts. */
  instrumentations?: Instrumentation[];
}

let provider: NodeTracerProvider | undefined;

function resolveTracesUrl(): string | undefined {
  const explicit = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (explicit) return explicit;
  if (base) return `${base.replace(/\/+$/, '')}/v1/traces`;
  return undefined;
}

/**
 * True when an OTLP traces endpoint is configured. Callers use this to skip
 * wiring work that is pointless when no collector will consume the spans
 * (e.g. BullMQ's job-level telemetry).
 */
export function isTracingEnabled(): boolean {
  return resolveTracesUrl() !== undefined;
}

function resolveSampler() {
  const ratio = Number(process.env.OTEL_TRACES_SAMPLE_RATE);
  if (Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) {
    return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
  }
  // Default: sample 10% of root spans (children inherit via ParentBased), so
  // the exporter cost stays bounded under sustained load. Set
  // OTEL_TRACES_SAMPLE_RATE=1 for always-on tracing.
  return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.1) });
}

/**
 * Bootstraps the OpenTelemetry trace provider and registers the given Node
 * instrumentations.
 *
 * Safety properties:
 *  - Idempotent: the first successful call wins; later calls return the same
 *    shutdown function.
 *  - No-op when no `OTEL_EXPORTER_OTLP_ENDPOINT` / `..._TRACES_ENDPOINT` is
 *    set, so local/dev runs never pay for telemetry plumbing.
 *  - Fail-safe: a broken exporter, bad sampler or unresolvable instrumentation
 *    logs a warning and tracing is disabled instead of crashing startup.
 *
 * Must run BEFORE application modules are imported (via `node --import`), so
 * the http/ioredis require hooks are installed before anything loads them.
 * Returns a shutdown function, or undefined when tracing was not initialized.
 */
export function initTracing(opts: TracingOptions): (() => Promise<void>) | undefined {
  if (provider) return shutdownTracing;
  const url = resolveTracesUrl();
  if (!url) return undefined;

  try {
    const resource = defaultResource().merge(
      resourceFromAttributes({
        [SEMRESATTRS_SERVICE_NAME]: opts.serviceName,
        [SEMRESATTRS_SERVICE_VERSION]: opts.serviceVersion ?? 'dev',
      }),
    );

    provider = new NodeTracerProvider({
      resource,
      sampler: resolveSampler(),
      spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url }) })],
    });
    provider.register();

    if (opts.instrumentations && opts.instrumentations.length > 0) {
      registerInstrumentations({ instrumentations: opts.instrumentations });
    }

    console.log(`[tracing] initialized service=${opts.serviceName} url=${url}`);
    return shutdownTracing;
  } catch (err) {
    console.warn('[tracing] initialization failed; tracing disabled:', err);
    return undefined;
  }
}

/** Flushes and shuts down the global trace provider (best-effort). */
export async function shutdownTracing(): Promise<void> {
  if (!provider) return;
  const active = provider;
  provider = undefined;
  try {
    await active.shutdown();
  } catch {
    // Best-effort flush on shutdown; never block process exit.
  }
}
