import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{source:"/:path*", headers:[
      {key:"X-Frame-Options",value:"DENY"},
      {key:"X-Content-Type-Options",value:"nosniff"},
      {key:"Referrer-Policy",value:"no-referrer"},
      {key:"Content-Security-Policy",value:`default-src 'self'; script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`},
    ]}];
  },
  outputFileTracingRoot: process.cwd(),
  // IMAP/메일 파싱/PDF 는 Node 전용 런타임 의존이라 번들에 넣지 않고 서버에서 그대로 require 한다.
  serverExternalPackages: ["imapflow", "mailparser", "unpdf", "ws"],
};

export default nextConfig;
