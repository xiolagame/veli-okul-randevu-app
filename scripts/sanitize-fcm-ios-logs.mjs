import fs from 'node:fs';

const pluginPath = 'node_modules/@capacitor-community/fcm/ios/Plugin/Plugin.swift';
const source = fs.readFileSync(pluginPath, 'utf8');
const requiredStructure = [
  '@objc(FCMPlugin)',
  '@objc func getToken(',
  '@objc func refreshToken(',
  'notifyListeners("tokenReceived"',
];
if (requiredStructure.some((part) => !source.includes(part))) {
  throw new Error('Unexpected FCM iOS plugin structure');
}

const expectedPrints = new Map([
  [String.raw`print("ERROR while trying to subscribe topic \(topicName)")`, 1],
  [String.raw`print("Error fetching FCM registration token: \(error)")`, 2],
  [String.raw`print("FCM registration token: \(token)")`, 2],
  [String.raw`print("Error deleting FCM token: \(error)")`, 1],
  [String.raw`print("Error deleting installation: \(error)")`, 1],
]);
const counts = new Map([...expectedPrints.keys()].map((statement) => [statement, 0]));
const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const sanitized = lines.filter((line) => {
  const statement = /^[\t ]*(print\([^\r\n]*\))[\t ]*\r?\n?$/.exec(line)?.[1];
  if (!statement || !expectedPrints.has(statement)) return true;
  counts.set(statement, counts.get(statement) + 1);
  return false;
}).join('');

const removedCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
if (removedCount !== 0 && [...expectedPrints].some(([statement, count]) => counts.get(statement) !== count)) {
  throw new Error('Unexpected FCM iOS plugin print statement set');
}

if (/print\([^\r\n]*(?:token|error)/i.test(sanitized)) {
  throw new Error('Unexpected FCM iOS plugin token or error print statement');
}

if (sanitized !== source) {
  fs.writeFileSync(pluginPath, sanitized);
}
