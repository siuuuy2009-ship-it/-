import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { rootCertificates, checkServerIdentity } from 'node:tls';
import { test } from 'node:test';
import { Client } from 'pg';
import { postgresConfig } from '../db/postgres-config.ts';
import { supabaseCa } from '../db/supabase-ca.ts';

void test('bundled Supabase certificate matches the verified official CA', () => {
  const cert = new X509Certificate(supabaseCa);
  assert.equal(cert.ca, true);
  assert.equal(cert.verify(cert.publicKey), true);
  assert.equal(
    cert.fingerprint256,
    '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
  );
  assert.ok(Date.parse(cert.validFrom) < Date.now());
  assert.ok(Date.parse(cert.validTo) > Date.now());
  // A trusted chain must still match the requested database hostname.
  assert.equal(
    (
      checkServerIdentity(
        'unrelated.example',
        cert.toLegacyObject(),
      ) as Error & {
        code?: string;
      }
    )?.code,
    'ERR_TLS_CERT_ALTNAME_INVALID',
  );
});

void test('Supabase trust survives pg URI parsing without weakening TLS', () => {
  for (const host of [
    'aws-0-ap-northeast-2.pooler.supabase.com',
    'db.exampleproject.supabase.co',
  ]) {
    for (const query of [
      '',
      '?sslmode=require',
      '?ssl=no-verify',
      '?ssl=false&sslmode=disable',
      '?sslcert=missing&sslkey=missing&sslrootcert=missing&uselibpqcompat=true',
    ]) {
      const config = postgresConfig(
        `postgresql://postgres:example@${host}:6543/postgres${query}`,
      );
      const client = new Client(config);
      assert.deepEqual(client.ssl, {
        rejectUnauthorized: true,
        ca: [...rootCertificates, supabaseCa],
      });
    }
  }
});

void test('additional trust is scoped to Supabase; custom CA remains supported', () => {
  for (const host of [
    'localhost',
    'database.example',
    'aws.pooler.supabase.com.evil.example',
    'fakepooler.supabase.com',
    'supabase.co',
  ]) {
    const client = new Client(
      postgresConfig(`postgresql://postgres:example@${host}/postgres`),
    );
    assert.deepEqual(client.ssl, { rejectUnauthorized: true });
  }
  const overriddenHost = postgresConfig(
    'postgresql://postgres:example@aws.pooler.supabase.com/postgres?host=database.example',
  );
  assert.deepEqual(overriddenHost.ssl, { rejectUnauthorized: true });
  const custom = postgresConfig(
    'postgresql://postgres:example@database.example/postgres',
    supabaseCa.replace(/\n/g, '\\n'),
  );
  assert.deepEqual(custom.ssl, { rejectUnauthorized: true, ca: supabaseCa });
  assert.throws(() => postgresConfig('https://example.supabase.co'), {
    code: 'INVALID_DATABASE_PROTOCOL',
  });
});
