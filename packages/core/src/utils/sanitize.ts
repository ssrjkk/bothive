/**
 * Replaces control characters (C0 range \u0000-\u001f, DEL \u007f, NEL \u0085)
 * and Unicode line/paragraph separators (\u2028, \u2029) with a single space.
 * Used before persisting user-provided text so raw control bytes never end up
 * in logs, errors, CSV output, or Prometheus labels.
 */
export function stripControlChars(value: string): string {
  let result = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    // C0 controls + DEL + NEL (U+0085) + line separator (U+2028) + paragraph
    // separator (U+2029) all become a single space.
    result += code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029
      ? ' '
      : ch;
  }
  return result;
}
