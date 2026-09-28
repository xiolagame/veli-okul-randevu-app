import { randomInt } from 'node:crypto';

const LICENSE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomGroup(): string {
  return Array.from({ length: 4 }, () => LICENSE_ALPHABET[randomInt(LICENSE_ALPHABET.length)]).join('');
}

export function generateSchoolLicenseCode(): string {
  return `VR-${randomGroup()}-${randomGroup()}-${randomGroup()}`;
}
