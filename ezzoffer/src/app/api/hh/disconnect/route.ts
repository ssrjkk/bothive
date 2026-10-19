import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { clearHhConnection } from '@/lib/hh-oauth';

export async function POST() {
  const user = await requireUser();
  if (!user) return unauthorized();
  clearHhConnection(user.id);
  return NextResponse.json({ ok: true });
}
