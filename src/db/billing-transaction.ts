import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import WebSocket from "ws";
import * as schema from "./schema";

type Transaction = Parameters<Parameters<NeonDatabase<typeof schema>["transaction"]>[0]>[0];

// Neon HTTP cannot run interactive transactions. Keep this connection scoped
// to one atomic billing operation, including rollback and cleanup.
export async function withBillingTransaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    return await drizzle(pool, { schema }).transaction(callback);
  } finally {
    await pool.end();
  }
}
