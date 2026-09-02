import WebSocket from "ws";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export function createPartnerTransactionDb() {
  const url = process.env.DATABASE_URL;
  if (!url || url === "postgresql://your-neon-url-here") {
    throw new Error("DATABASE_URL is not configured. Please set it in .env.local");
  }

  // neon-http는 interactive transaction을 지원하지 않는다. 협력사 신청 묶음은
  // revision 검사부터 항목 교체와 operation 원장 기록까지 한 트랜잭션이어야 하므로,
  // 이 쓰기 경로만 Neon WebSocket 드라이버를 사용한다. 호출자는 서버리스 실행이
  // 끝나기 전에 `$client.end()`로 연결을 닫아야 한다.
  return drizzle({ connection: url, schema, ws: WebSocket });
}
