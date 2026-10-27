import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../domain.ts';

export const secretToken = () => randomBytes(24).toString('hex');
export const tokenHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      32,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
export async function hashPassword(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128)
    throw new DomainError('비밀번호는 10~128자로 정해 주세요.');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(value, salt);
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function checkPassword(
  value: unknown,
  hash: string | null,
): Promise<boolean> {
  if (typeof value !== 'string' || value.length > 128) return false;
  const parts = hash?.split('$');
  const valid =
    parts?.length === 3 &&
    parts[0] === 'scrypt' &&
    /^[a-f0-9]{32}$/.test(parts[1]) &&
    /^[a-f0-9]{64}$/.test(parts[2]);
  // A missing account still performs the same password derivation.
  const key = await derive(
    value,
    valid ? parts[1] : '00000000000000000000000000000000',
  );
  return !!valid && timingSafeEqual(key, Buffer.from(parts[2], 'hex'));
}
