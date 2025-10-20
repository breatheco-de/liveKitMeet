import { NextRequest, NextResponse } from 'next/server';
import { AccessToken, VideoGrant, AccessTokenOptions } from 'livekit-server-sdk';

const TOKEN_ENDPOINT = process.env.TOKEN_ENDPOINT || '';                 // e.g. https://api.4geeks.com/v1/events/event/{id}/livekit/token
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';                       // fallback (emit token in Vercel)
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const roomName = url.searchParams.get('roomName') || '';
    const participantName = url.searchParams.get('participantName') || '';

    if (!roomName || !roomName.startsWith('event-')) {
      return new NextResponse('Invalid roomName', { status: 400 });
    }
    if (!participantName) {
      return new NextResponse('Missing participantName', { status: 400 });
    }

    // Prefer using your backend (recommended). If not configured, fallback to emitting the token here.
    if (TOKEN_ENDPOINT) {
      const eventId = roomName.replace('event-', '');
      const tokenUrl = TOKEN_ENDPOINT.replace('{id}', eventId);

      // Forward session context if available (Authorization/cookies)
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
        return new NextResponse(body || 'Upstream token endpoint error', { status: res.status });
      }

      const data = await res.json(); // { serverUrl, token }
      if (!data?.serverUrl || !data?.token) {
        return new NextResponse('Invalid token response from backend', { status: 502 });
      }

      return NextResponse.json({
        serverUrl: data.serverUrl,
        roomName,
        participantName,
        participantToken: data.token,
      });
    }

    // Fallback: emit token on Vercel if LIVEKIT_* is provided
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return new NextResponse(
        'LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET or TOKEN_ENDPOINT must be configured',
        { status: 500 },
      );
    }

    const participantToken = createParticipantToken(
      { identity: participantName, name: participantName },
      roomName,
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
    );

    return NextResponse.json({
      serverUrl: LIVEKIT_URL,
      roomName,
      participantName,
      participantToken,
    });
  } catch (err: any) {
    return new NextResponse(err?.message || 'Internal Server Error', { status: 500 });
  }
}

function createParticipantToken(
  userInfo: AccessTokenOptions,
  roomName: string,
  apiKey: string,
  apiSecret: string,
) {
  const at = new AccessToken(apiKey, apiSecret, userInfo);
  at.ttl = '5m';
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);
  return at.toJwt();
}
