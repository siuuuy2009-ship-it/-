// Only fixed, non-secret codes may reach logs. Driver messages, URLs, query
// parameters and error objects can contain credentials or user data.
const safeCodes = new Set([
  'ERR_INVALID_URL',
  'INVALID_DATABASE_PROTOCOL',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08P01',
  '28000',
  '28P01',
  '3D000',
  '3F000',
  '42501',
  '42601',
  '42P01',
  '53300',
  '57014',
  '57P01',
  '57P03',
  'XX000',
]);

export function storageErrorCode(error: unknown, depth = 0): string {
  if (!error || typeof error !== 'object' || depth > 3) return 'UNKNOWN';
  const detail = error as {
    code?: unknown;
    cause?: unknown;
    message?: unknown;
  };
  if (typeof detail.code === 'string' && safeCodes.has(detail.code))
    return detail.code;
  if (
    detail.message === 'Connection terminated due to connection timeout' ||
    detail.message === 'timeout exceeded when trying to connect'
  )
    return 'CONNECTION_TIMEOUT';
  if (detail.message === 'Tenant or user not found')
    return 'POOLER_TENANT_NOT_FOUND';
  if (error instanceof AggregateError) {
    for (const cause of error.errors) {
      const code = storageErrorCode(cause, depth + 1);
      if (code !== 'UNKNOWN') return code;
    }
  }
  return storageErrorCode(detail.cause, depth + 1);
}
