import { readRosterFile } from './roster-files';
self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer; name: string }>) => {
  try { self.postMessage({ records: await readRosterFile(event.data.buffer, event.data.name) }); }
  catch (cause) { self.postMessage({ error: cause instanceof Error ? cause.message : 'Dosya okunamadı.' }); }
};
