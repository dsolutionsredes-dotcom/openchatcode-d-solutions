import { createSign } from 'node:crypto';

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_EARLY_REFRESH_MS = 60_000;
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface GoogleDriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  canDownload: boolean;
}

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

let cachedToken: AccessTokenCache | null = null;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function serviceAccountCredentials(): ServiceAccountCredentials {
  const encoded = process.env.OPENCHATCUT_GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const raw = encoded
    ? Buffer.from(encoded, 'base64').toString('utf8')
    : process.env.OPENCHATCUT_GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new Error('Google Drive directo no está configurado. Define OPENCHATCUT_GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64 en EasyPanel.');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('La credencial de servicio de Google Drive no contiene JSON válido.');
  }
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const clientEmail = typeof record.client_email === 'string' ? record.client_email.trim() : '';
  const privateKey = typeof record.private_key === 'string' ? record.private_key : '';
  const tokenUri = typeof record.token_uri === 'string' ? record.token_uri.trim() : '';
  if (!clientEmail.endsWith('.iam.gserviceaccount.com') || !privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error('La credencial de servicio de Google Drive es inválida.');
  }
  return { client_email: clientEmail, private_key: privateKey, ...(tokenUri ? { token_uri: tokenUri } : {}) };
}

function driveFileId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!DRIVE_FILE_ID.test(id)) throw new Error('driveId válido es obligatorio para importar desde Google Drive.');
  return id;
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + TOKEN_EARLY_REFRESH_MS) return cachedToken.token;
  const credentials = serviceAccountCredentials();
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = credentials.token_uri || 'https://oauth2.googleapis.com/token';
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: DRIVE_READONLY_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const assertion = `${header}.${payload}.${signer.sign(credentials.private_key, 'base64url')}`;
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const token = typeof body.access_token === 'string' ? body.access_token : '';
  const seconds = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in);
  if (!response.ok || !token || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Google no autorizó la cuenta de servicio para leer Drive. Verifica que la carpeta AutoVideoEditor esté compartida con ella.');
  }
  cachedToken = { token, expiresAt: Date.now() + (seconds * 1000) };
  return token;
}

async function driveFetch(fileId: string, query: URLSearchParams): Promise<Response> {
  const token = await accessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${query.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: unknown } };
    const message = typeof body.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`;
    throw new Error(`Google Drive no permitió leer este archivo: ${message}`);
  }
  return response;
}

export async function googleDriveFileMetadata(value: unknown): Promise<GoogleDriveFileMetadata> {
  const id = driveFileId(value);
  const response = await driveFetch(id, new URLSearchParams({
    fields: 'id,name,mimeType,size,capabilities(canDownload)',
    supportsAllDrives: 'true',
  }));
  const body = await response.json() as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.split(';', 1)[0]!.trim().toLowerCase() : '';
  const size = Number(body.size);
  const capabilities = body.capabilities && typeof body.capabilities === 'object'
    ? body.capabilities as Record<string, unknown>
    : {};
  if (!name || !mimeType || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error('Google Drive no devolvió metadatos válidos para este archivo.');
  }
  return { id, name, mimeType, size, canDownload: capabilities.canDownload !== false };
}

export async function googleDriveFileStream(value: unknown): Promise<ReadableStream<Uint8Array>> {
  const id = driveFileId(value);
  const response = await driveFetch(id, new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' }));
  if (!response.body) throw new Error('Google Drive devolvió el archivo sin contenido.');
  return response.body;
}
