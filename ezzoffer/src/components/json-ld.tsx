const ESCAPE_MAP: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

function escapeJsonForScript(value: string): string {
  return value.replace(/[<>&\u2028\u2029]/g, (ch) => ESCAPE_MAP[ch]);
}

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: escapeJsonForScript(JSON.stringify(data)) }}
    />
  );
}
