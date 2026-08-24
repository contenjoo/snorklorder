import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, createRateLimitResponse } from '@/lib/security';
import { translateSchoolName } from '@/lib/romanize';

// Google 비공식 endpoint. 데이터센터 IP(Vercel)에서는 429로 차단되는 일이 잦다 —
// 실패하면 아래 로컬 로마자 변환으로 폴백하므로 이 호출은 best-effort.
async function googleTranslate(text: string): Promise<string | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    const translated = (data[0] as [string][]).map((segment) => segment[0]).join('');
    return translated.trim() || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit({
    request: req,
    key: 'translate',
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.ok) {
    return createRateLimitResponse('Too many translation requests. Please try again later.', rateLimit.retryAfter);
  }

  try {
    const { text } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const viaGoogle = await googleTranslate(text.trim());
    if (viaGoogle) {
      return NextResponse.json({ translated: viaGoogle, source: 'google' });
    }

    const translated = translateSchoolName(text);
    if (!translated) {
      return NextResponse.json({ error: 'Translation failed' }, { status: 502 });
    }
    return NextResponse.json({ translated, source: 'romanize' });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
