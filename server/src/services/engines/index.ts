import { STT_MODEL } from '../sarvamRealtime.js';
import {
  LOCAL_MODEL,
  cachedHealth,
  createLocalSttClient,
  createLocalWhisperEngine,
  type LocalSttClient,
} from './localWhisper.js';
import { createSarvamEngine } from './sarvam.js';
import type { EngineFactory, EngineId, EngineInfo } from './types.js';

export interface Engines {
  factories: Partial<Record<EngineId, EngineFactory>>;
  /** For /api/meta: which engines exist and whether they're up right now. */
  status(): Promise<EngineInfo[]>;
}

export function createEngines(options: {
  sarvamApiKey: string;
  /** Base URL of the stt-local sidecar; omit to disable the self-hosted engine. */
  localSttUrl?: string;
  /** Test overrides. */
  sarvamRealtimeUrl?: string;
  localClient?: LocalSttClient;
}): Engines {
  const factories: Engines['factories'] = {
    sarvam: createSarvamEngine({
      apiKey: options.sarvamApiKey,
      ...(options.sarvamRealtimeUrl ? { realtimeUrl: options.sarvamRealtimeUrl } : {}),
    }),
  };

  const localClient =
    options.localClient ??
    (options.localSttUrl ? createLocalSttClient(options.localSttUrl) : undefined);
  const localUp = localClient ? cachedHealth(localClient) : async () => false;
  if (localClient) factories.local = createLocalWhisperEngine(localClient);

  return {
    factories,
    async status() {
      return [
        {
          id: 'sarvam',
          label: `Sarvam ${STT_MODEL}`,
          kind: 'third-party',
          model: STT_MODEL,
          available: true,
          summary: 'Third-party API · 23 languages · live word-by-word',
        },
        {
          id: 'local',
          label: 'Whisper Hinglish',
          kind: 'self-hosted',
          model: LOCAL_MODEL,
          available: await localUp(),
          summary: 'Self-hosted open-source · runs on our server · Hindi/English → Hinglish',
        },
      ];
    },
  };
}
