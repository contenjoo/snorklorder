import { secretEquals } from "@/lib/api-key";
/** Vercel cron uses Bearer; manual integrations use x-api-key. URL keys are never accepted. */
export function authorizeCron(req: Request): boolean {
 return secretEquals(req.headers.get("authorization"),process.env.CRON_SECRET?.trim() ? `Bearer ${process.env.CRON_SECRET.trim()}` : undefined)
   || secretEquals(req.headers.get("x-api-key"),process.env.INTEGRATION_API_KEY);
}
