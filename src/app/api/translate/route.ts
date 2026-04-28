import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, createRateLimitResponse } from '@/lib/security';

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

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);

    if (!res.ok) {
      return NextResponse.json({ error: 'Translation failed' }, { status: 502 });
    }

    const data = await res.json();
    const translated: string = data[0]
      .map((segment: [string]) => segment[0])
      .join('');

    return NextResponse.json({ translated });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
