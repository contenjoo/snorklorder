import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // IMAP/메일 파싱/PDF 는 Node 전용 런타임 의존이라 번들에 넣지 않고 서버에서 그대로 require 한다.
  serverExternalPackages: ["imapflow", "mailparser", "unpdf"],
};

export default nextConfig;
