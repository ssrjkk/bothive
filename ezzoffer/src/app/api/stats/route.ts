import { requireUser, unauthorized } from '@/lib/api';
import { getStats } from '@/lib/stats';
import { NO_STORE_HEADERS } from '@/lib/http';

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();
  return Response.json({ stats: getStats(user.id) }, { headers: NO_STORE_HEADERS });
}
