import { readRosterBlob } from './roster-files';
self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try { self.postMessage({ records: await readRosterBlob(event.data.file,event.data.file.name,read=>self.postMessage({read})) }); }
  catch (cause) { self.postMessage({ error: cause instanceof Error ? cause.message : 'Dosya okunamadı.' }); }
};
