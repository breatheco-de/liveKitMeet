'use client';
import React from 'react';
import { useSearchParams } from 'next/navigation';
import { ConnectionDetails } from '@/lib/types';
import { PreJoin, LocalUserChoices, VideoConference, RoomContext, formatChatMessageLinks } from '@livekit/components-react';
import { Room, RoomEvent, RoomConnectOptions, DeviceUnsupportedError, ExternalE2EEKeyProvider, VideoCodec, VideoPresets, TrackPublishDefaults, VideoCaptureOptions, RoomOptions } from 'livekit-client';
import { useRouter } from 'next/navigation';

const TOKEN_ENDPOINT = process.env.NEXT_PUBLIC_TOKEN_ENDPOINT || '';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: { roomName: string; region?: string; hq: boolean; codec: VideoCodec; }) {
  const searchParams = useSearchParams();
  const qsToken = searchParams.get('token') || '';
  const qsServerUrl = searchParams.get('serverUrl') || '';
  const qsParticipantName = searchParams.get('participantName') || '';

  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices>();
  const [conn, setConn] = React.useState<ConnectionDetails>();

  // Auto‑join si vienen query params
  React.useEffect(() => {
    if (qsToken && qsServerUrl) {
      setPreJoinChoices({
        username: qsParticipantName || '',
        videoEnabled: true,
        audioEnabled: true,
        videoDeviceId: '',
        audioDeviceId: '',
      });
      setConn({
        serverUrl: qsServerUrl,
        roomName: props.roomName,
        participantToken: qsToken,
        participantName: qsParticipantName || '',
      });
    }
  }, [qsToken, qsServerUrl, qsParticipantName, props.roomName]);

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    if (qsToken && qsServerUrl) {
      setPreJoinChoices(values);
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
    if (!resp.ok) throw new Error(await resp.text());

    const data = await resp.json() as { serverUrl: string; token: string; participantName?: string };
    setConn({
      serverUrl: data.serverUrl,
      roomName: props.roomName,
      participantToken: data.token,
      participantName: data.participantName || values.username,
    });
  }, [props.roomName, qsToken, qsServerUrl]);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {!conn || !preJoinChoices ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <PreJoin
            defaults={{ username: qsParticipantName || '', videoEnabled: true, audioEnabled: true, videoDeviceId: '', audioDeviceId: '' }}
            onSubmit={handlePreJoinSubmit}
            onError={(e) => console.error(e)}
          />
        </div>
      ) : (
        <VideoConferenceWrapper connectionDetails={conn} userChoices={preJoinChoices} codec={props.codec} hq={props.hq} />
      )}
    </main>
  );
}

function VideoConferenceWrapper({ connectionDetails, userChoices, codec, hq }:
  { connectionDetails: ConnectionDetails; userChoices: LocalUserChoices; codec: VideoCodec; hq: boolean; }) {

  const roomOptions = React.useMemo<RoomOptions>(() => {
    let videoCodec: VideoCodec | undefined = codec || 'vp9';
    const videoCaptureDefaults: VideoCaptureOptions = { deviceId: userChoices.videoDeviceId || '', resolution: hq ? VideoPresets.h2160 : VideoPresets.h720 };
    const publishDefaults: TrackPublishDefaults = { dtx: false, videoSimulcastLayers: hq ? [VideoPresets.h1080, VideoPresets.h720] : [VideoPresets.h540, VideoPresets.h216], red: true, videoCodec };
    return { videoCaptureDefaults, publishDefaults, audioCaptureDefaults: { deviceId: userChoices.audioDeviceId || '' }, adaptiveStream: true, dynacast: true };
  }, [userChoices, hq, codec]);

  const room = React.useMemo(() => new Room(roomOptions), [roomOptions]);
  const router = useRouter();

  React.useEffect(() => {
    const connectOptions: RoomConnectOptions = { autoSubscribe: true };
    room.on(RoomEvent.Disconnected, () => router.push('/'));
    room.connect(connectionDetails.serverUrl, connectionDetails.participantToken, connectOptions)
      .then(async () => {
        if (userChoices.videoEnabled) await room.localParticipant.setCameraEnabled(true);
        if (userChoices.audioEnabled) await room.localParticipant.setMicrophoneEnabled(true);
      })
      .catch((e) => { console.error(e); alert(e.message); });
    return () => { room.disconnect(true); };
  }, [room, connectionDetails, userChoices, router]);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <VideoConference chatMessageFormatter={formatChatMessageLinks} />
        {SHOW_SETTINGS_MENU ? <SettingsMenu /> : null}
        <DebugMode />
        <RecordingIndicator />
        <KeyboardShortcuts />
      </RoomContext.Provider>
    </div>
  );
}
