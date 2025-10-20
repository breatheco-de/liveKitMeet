import { NextRequest, NextResponse } from 'next/server';

const TOKEN_ENDPOINT = process.env.TOKEN_ENDPOINT || '';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const roomName = url.searchParams.get('roomName') || '';
  const participantName = url.searchParams.get('participantName') || '';

  if (!roomName.startsWith('event-')) {
    return new NextResponse('Invalid roomName', { status: 400 });
  }
  if (!TOKEN_ENDPOINT) {
    return new NextResponse('TOKEN_ENDPOINT is not configured', { status: 500 });
  }

  const eventId = roomName.replace('event-', '');
  const tokenUrl = TOKEN_ENDPOINT.replace('{id}', eventId);

  // reenviamos sesión/cookies para que tu API valide IsAuthenticated
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      cookie: request.headers.get('cookie') ?? '',
      authorization: request.headers.get('authorization') ?? '',
      'content-type': 'application/json',
    },
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.text();
    return new NextResponse(body, { status: res.status });
  }

  const data = await res.json(); // { serverUrl, token }
  return NextResponse.json({
    serverUrl: data.serverUrl,
    roomName,
    participantName,
    participantToken: data.token,
  });
}
