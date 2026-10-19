import { NextResponse } from 'next/server';
import { parseParamId, isUniqueViolation } from './validate';

export { parseParamId, isUniqueViolation };

export const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export function apiError(
  message: string,
  status = 400,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { ...NO_STORE_HEADERS, ...headers } },
  );
}
