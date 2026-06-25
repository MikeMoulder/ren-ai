import crypto from 'node:crypto';
import { config } from './config.js';

// AES-256-GCM encryption for user API credentials at rest.
// Format stored: iv(12b).tag(16b).ciphertext, base64.

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(blob) {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// Show only the tail of a key for the UI, never the secret.
export function maskKey(key) {
  if (!key) return '';
  const s = String(key);
  return s.length <= 6 ? '••••' : `••••${s.slice(-4)}`;
}
