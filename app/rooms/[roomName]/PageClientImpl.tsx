'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ConnectionDetails } from '@/lib/types';
import {
  PreJoin,
  LocalUserChoices,
  VideoConference,
  RoomContext,
  formatChatMessageLinks,
} from '@livekit/components-react';
import {
  Room,
  RoomEvent,
  RoomOptions,
  RoomConnectOptions,
  VideoCodec,
  VideoPresets,
  TrackPublishDefaults,
  VideoCaptureOptions,
} from 'livekit-client';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { DebugMode } from '@/lib/Debug';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';

const TOKEN_ENDPOINT = process.env.NEXT_PUBLIC_TOKEN_ENDPOINT || '';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

// Intenta leer el `name` del JWT solo para UI
function decodeNameFromToken(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    const name = (json?.name || '').toString().trim();
    return name || null;
  } catch {
    return null;
  }
}

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
}) {
  const searchParams = useSearchParams();
  const qsToken = searchParams.get('token') || '';
  const qsServerUrl = searchParams.get('serverUrl') || '';
  const qsParticipantName = searchParams.get('participantName') || '';

  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  // Valores por defecto válidos para LocalUserChoices
  const preJoinDefaults = React.useMemo<LocalUserChoices>(
    () => ({
      username: '',
      videoEnabled: true,
      audioEnabled: true,
      videoDeviceId: '',
      audioDeviceId: '',
    }),
    [],
  );

  // Auto-join si vienen token y serverUrl en query
  React.useEffect(() => {
    if (qsToken && qsServerUrl) {
      const pname = qsParticipantName || decodeNameFromToken(qsToken) || '';
      setPreJoinChoices({
        username: pname,
        videoEnabled: true,
        audioEnabled: true,
        videoDeviceId: '',
        audioDeviceId: '',
      });
      setConnectionDetails({
        serverUrl: qsServerUrl,
        roomName: props.roomName,
        participantToken: qsToken,
        participantName: pname,
      });
    }
  }, [qsToken, qsServerUrl, qsParticipantName, props.roomName]);

  const handlePreJoinSubmit = React.useCallback(
    async (values: LocalUserChoices) => {
      // Si ya hay token por query, no llames al backend
      if (qsToken && qsServerUrl) {
        setPreJoinChoices({
          username: values.username,
          videoEnabled: values.videoEnabled,
          audioEnabled: values.audioEnabled,
          videoDeviceId: values.videoDeviceId || '',
          audioDeviceId: values.audioDeviceId || '',
        });
        return;
      }

      if (!TOKEN_ENDPOINT) throw new Error('NEXT_PUBLIC_TOKEN_ENDPOINT is not configured');

      setPreJoinChoices({
        username: values.username,
        videoEnabled: values.videoEnabled,
        audioEnabled: values.audioEnabled,
        videoDeviceId: values.videoDeviceId || '',
        audioDeviceId: values.audioDeviceId || '',
      });

      const eventId = props.roomName.replace('event-', '');
      const url = TOKEN_ENDPOINT.replace('{id}', eventId);

      const resp = await fetch(url, { method: 'GET', credentials: 'include' });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Token endpoint failed with ${resp.status}`);
      }

      const data = (await resp.json()) as {
        serverUrl: string;
        token: string;
        participantName?: string;
      };

      setConnectionDetails({
        serverUrl: data.serverUrl,
        roomName: props.roomName,
        participantToken: data.token,
        participantName: data.participantName || values.username,
      });
    },
    [props.roomName, qsToken, qsServerUrl],
  );

  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);

  const shouldShowPreJoin = !connectionDetails || !preJoinChoices;

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {shouldShowPreJoin ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <PreJoin
            defaults={{
              ...preJoinDefaults,
              username: qsParticipantName || preJoinDefaults.username,
            }}
            onSubmit={handlePreJoinSubmit}
            onError={handlePreJoinError}
          />
        </div>
      ) : (
        <VideoConferenceWrapper
          connectionDetails={connectionDetails!}
          userChoices={preJoinChoices!}
          codec={props.codec}
          hq={props.hq}
        />
      )}
    </main>
  );
}

function VideoConferenceWrapper({
  connectionDetails,
  userChoices,
  codec,
  hq,
}: {
  connectionDetails: ConnectionDetails;
  userChoices: LocalUserChoices;
  codec: VideoCodec;
  hq: boolean;
}) {
  // Opciones del Room (sin E2EE para minimizar dependencias)
  const roomOptions = React.useMemo<RoomOptions>(() => {
    let videoCodec: VideoCodec | undefined = codec || 'vp9';
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: userChoices.videoDeviceId || '',
      resolution: hq ? VideoPresets.h2160 : VideoPresets.h720,
    };
    const publishDefaults: TrackPublishDefaults = {
      dtx: false,
      videoSimulcastLayers: hq ? [VideoPresets.h1080, VideoPresets.h720] : [VideoPresets.h540, VideoPresets.h216],
      red: true,
      videoCodec,
    };
    return {
      videoCaptureDefaults,
      publishDefaults,
      audioCaptureDefaults: {
        deviceId: userChoices.audioDeviceId || '',
      },
      adaptiveStream: true,
      dynacast: true,
    };
  }, [userChoices, hq, codec]);

  const room = React.useMemo(() => new Room(roomOptions), [roomOptions]);
  const router = useRouter();

  React.useEffect(() => {
    const connectOptions: RoomConnectOptions = { autoSubscribe: true };

    const onDisconnect = () => router.push('/');
    const onEncryptionError = (error: Error) => {
      console.error(error);
      alert(`Encryption error: ${error.message}`);
    };
    const onMediaDevicesError = (error: Error) => {
      console.error(error);
      alert(`Media devices error: ${error.message}`);
    };

    room.on(RoomEvent.Disconnected, onDisconnect);
    room.on(RoomEvent.EncryptionError, onEncryptionError);
    room.on(RoomEvent.MediaDevicesError, onMediaDevicesError);

    room
      .connect(connectionDetails.serverUrl, connectionDetails.participantToken, connectOptions)
      .then(async () => {
        if (userChoices.videoEnabled) await room.localParticipant.setCameraEnabled(true);
        if (userChoices.audioEnabled) await room.localParticipant.setMicrophoneEnabled(true);
      })
      .catch((error) => {
        console.error(error);
        alert(`Unexpected error: ${error.message}`);
      });

    return () => {
      room.off(RoomEvent.Disconnected, onDisconnect);
      room.off(RoomEvent.EncryptionError, onEncryptionError);
      room.off(RoomEvent.MediaDevicesError, onMediaDevicesError);
      room.disconnect(true);
    };
  }, [room, connectionDetails, userChoices, router]);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <VideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
        />
        <DebugMode />
        <RecordingIndicator />
        <KeyboardShortcuts />
      </RoomContext.Provider>
    </div>
  );
}
