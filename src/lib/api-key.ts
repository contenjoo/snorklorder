import { createHash, timingSafeEqual } from "node:crypto";
export function secretEquals(provided: string | null, expected: string | undefined) {
 if (!provided || !expected?.trim()) return false;
 return timingSafeEqual(createHash("sha256").update(provided).digest(),createHash("sha256").update(expected.trim()).digest());
}
