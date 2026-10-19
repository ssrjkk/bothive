import { getCurrentUser, publicUser } from '@/lib/auth';
import { NO_STORE_HEADERS } from '@/lib/http';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ user: null }, { headers: NO_STORE_HEADERS });
  return Response.json({ user: publicUser(user) }, { headers: NO_STORE_HEADERS });
}
