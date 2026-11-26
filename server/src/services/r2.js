import crypto from 'node:crypto';
import path from 'node:path';

const VIDEO_EXT_RE = /\.(mp4|m3u8|mkv|webm|mov|avi|ts|m4v)$/i;

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function md5Base64(data) {
  return crypto.createHash('md5').update(data).digest('base64');
}

function rfc3986Encode(str) {
  return encodeURIComponent(String(str)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function encodeS3Key(key) {
  return String(key || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((seg) => seg.length > 0)
    .map(rfc3986Encode)
    .join('/');
}

export function getR2Config(settings = null) {
  if (!settings) return { enabled: false };
  const enabled = Boolean(Number(settings.r2_storage || 0));
  const accessKeyId = String(settings.r2_access_key_id || '').trim();
  const secretAccessKey = String(settings.r2_secret_access_key || '').trim();
  const bucket = String(settings.r2_bucket || '').trim();
  const rawEndpoint = String(settings.r2_endpoint || '').trim().replace(/\/+$/, '');
  const publicUrl = String(settings.r2_public_url || '').trim().replace(/\/+$/, '');

  let endpointOrigin = '';
  if (rawEndpoint) {
    try {
      const parsed = new URL(rawEndpoint);
      const cleanPath = parsed.pathname.replace(/\/+$/, '');
      if (bucket && cleanPath === `/${bucket}`) {
        endpointOrigin = parsed.origin;
      } else {
        endpointOrigin = `${parsed.origin}${cleanPath}`;
      }
    } catch {
      endpointOrigin = rawEndpoint;
    }
  }

  return {
    enabled: Boolean(enabled && accessKeyId && secretAccessKey && bucket && endpointOrigin && publicUrl),
    r2_storage: enabled,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: endpointOrigin.replace(/\/+$/, ''),
    publicUrl,
  };
}

export function isR2Configured(settings = null) {
  return getR2Config(settings).enabled;
}

export function sanitizeVideoFilename(originalName) {
  const base = path.basename(String(originalName || 'video.mp4'));
  const ext = path.extname(base).toLowerCase();
  const stem = ext ? base.slice(0, -ext.length) : base;
  const safeStem = stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safeExt = ext && /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.mp4';
  return `${safeStem || `video_${Date.now()}`}${safeExt}`;
}

export function getDirectoryForMediaType(type = 'movie') {
  const t = String(type || '').toLowerCase();
  if (t === 'anime' || t === 'anime_episode') return 'animes/originals';
  if (t === 'serie' || t === 'series' || t === 'episode') return 'series/originals';
  if (t === 'upload' || t === 'general') return 'videos/uploads';
  return 'movies/originals';
}

export function buildR2ObjectKey(type, originalName) {
  const dir = getDirectoryForMediaType(type);
  const safe = sanitizeVideoFilename(originalName);
  const uid = crypto.randomUUID();
  return `${dir}/${uid}_${safe}`;
}

export function buildR2DeliveryUrl(cfg, key, settings = null) {
  const cleanKey = encodeS3Key(key);
  if (Number(settings?.cdn_enabled || 0) === 1 && settings?.cdn_base_url) {
    const cdn = String(settings.cdn_base_url).trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(cdn)) {
      return `${cdn}/${cleanKey}`;
    }
  }
  const base = String(cfg?.publicUrl || '').replace(/\/+$/, '');
  return base ? `${base}/${cleanKey}` : cleanKey;
}

export function extractR2Key(value, cfg = null) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (!/^https?:\/\//i.test(raw)) {
    const stripped = raw.replace(/^\/+/, '');
    if (cfg?.bucket && stripped.startsWith(`${cfg.bucket}/`)) {
      return stripped.slice(cfg.bucket.length + 1);
    }
    return stripped || null;
  }

  try {
    const parsed = new URL(raw);
    let p = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    if (cfg?.bucket && p.startsWith(`${cfg.bucket}/`)) {
      p = p.slice(cfg.bucket.length + 1);
    }
    return p || null;
  } catch {
    return null;
  }
}

function getSigV4Dates(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function deriveSigningKey(secretAccessKey, dateStamp, region = 'auto', service = 's3') {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function canonicalQueryString(params) {
  return Object.keys(params)
    .sort()
    .map((k) => `${rfc3986Encode(k)}=${rfc3986Encode(params[k])}`)
    .join('&');
}

function buildPathStyleUrl(cfg, key = '') {
  const endpointUrl = new URL(cfg.endpoint);
  const basePath = endpointUrl.pathname.replace(/\/+$/, '');
  const encodedKey = key ? encodeS3Key(key) : '';
  const canonicalUri = encodedKey ? `${basePath}/${cfg.bucket}/${encodedKey}` : `${basePath}/${cfg.bucket}`;
  return {
    endpointUrl,
    canonicalUri,
    fullUrl: `${endpointUrl.origin}${canonicalUri}`,
  };
}

function presignS3Url(cfg, { method = 'PUT', key, queryParams = {}, expiresSeconds = 3600 } = {}) {
  if (!cfg?.enabled) {
    throw new Error('Cloudflare R2 storage is not configured in Settings.');
  }
  const region = 'auto';
  const service = 's3';
  const { amzDate, dateStamp } = getSigV4Dates();
  const ttl = Math.max(60, Math.min(86400, Number(expiresSeconds || 3600)));
  const { endpointUrl, canonicalUri, fullUrl } = buildPathStyleUrl(cfg, key);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const allQuery = {
    ...queryParams,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(ttl),
    'X-Amz-SignedHeaders': 'host',
  };
  const qs = canonicalQueryString(allQuery);
  const canonicalHeaders = `host:${endpointUrl.host}\n`;
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    qs,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto
    .createHmac('sha256', deriveSigningKey(cfg.secretAccessKey, dateStamp, region, service))
    .update(stringToSign)
    .digest('hex');

  return `${fullUrl}?${qs}&X-Amz-Signature=${signature}`;
}

/**
 * Generates an AWS S3 SigV4 presigned PUT URL for direct browser-to-R2 uploads
 * without passing multi-hundred-MB payloads through Cloudflare Workers.
 */
export function presignPutObject(cfg, { key, expiresSeconds = 3600 } = {}) {
  return presignS3Url(cfg, { method: 'PUT', key, expiresSeconds });
}

export function presignUploadPart(cfg, { key, uploadId, partNumber, expiresSeconds = 7200 } = {}) {
  return presignS3Url(cfg, {
    method: 'PUT',
    key,
    queryParams: {
      partNumber: String(partNumber),
      uploadId: String(uploadId),
    },
    expiresSeconds,
  });
}

async function signedS3Fetch(
  cfg,
  { method = 'GET', key = '', query = {}, body = null, headers = {} } = {}
) {
  if (!cfg?.enabled) {
    throw new Error('Cloudflare R2 storage is not configured in Settings.');
  }
  const region = 'auto';
  const service = 's3';
  const { amzDate, dateStamp } = getSigV4Dates();
  const { endpointUrl, canonicalUri, fullUrl } = buildPathStyleUrl(cfg, key);
  const payload = body === null || body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
  const payloadHash = sha256Hex(payload);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const headerMap = {
    host: endpointUrl.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const outgoingHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (v === undefined || v === null || v === '') continue;
    const lk = k.toLowerCase();
    outgoingHeaders[lk] = String(v).trim();
    if (lk === 'content-md5' || lk === 'content-type') {
      headerMap[lk] = String(v).trim();
    }
  }

  const signedHeaderNames = Object.keys(headerMap).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headerMap[k]}\n`).join('');
  const signedHeadersStr = signedHeaderNames.join(';');
  const qs = canonicalQueryString(query || {});
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    qs,
    canonicalHeaders,
    signedHeadersStr,
    payloadHash,
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto
    .createHmac('sha256', deriveSigningKey(cfg.secretAccessKey, dateStamp, region, service))
    .update(stringToSign)
    .digest('hex');

  const requestUrl = qs ? `${fullUrl}?${qs}` : fullUrl;
  const authHeader = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  const fetchHeaders = {
    ...outgoingHeaders,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authHeader,
  };

  const response = await fetch(requestUrl, {
    method: method.toUpperCase(),
    headers: fetchHeaders,
    body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : payload,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Cloudflare R2 S3 ${method} failed (${response.status}): ${errText.slice(0, 300)}`);
  }
  return response;
}

export async function putObjectR2(cfg, { key, buffer, contentType = 'video/mp4', cacheControl = 'public, max-age=31536000, immutable' }) {
  return signedS3Fetch(cfg, {
    method: 'PUT',
    key,
    body: buffer,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    },
  });
}

export async function deleteObjectR2(cfg, key) {
  if (!key) return false;
  await signedS3Fetch(cfg, {
    method: 'DELETE',
    key,
  });
  return true;
}

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractXmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? decodeXmlEntities(m[1].trim()) : '';
}

export async function listObjectsR2(cfg, { prefix = '', maxKeys = 500, videosOnly = true } = {}) {
  const query = {
    'list-type': '2',
    'max-keys': String(Math.min(1000, Math.max(1, Number(maxKeys || 500)))),
  };
  if (prefix) query.prefix = prefix;

  const response = await signedS3Fetch(cfg, { method: 'GET', query });
  const xml = await response.text();
  const items = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gi)) {
    const block = match[1];
    const key = extractXmlTag(block, 'Key');
    if (!key) continue;
    if (videosOnly && !VIDEO_EXT_RE.test(key)) continue;
    const size = Number(extractXmlTag(block, 'Size') || 0);
    const lastModified = extractXmlTag(block, 'LastModified') || null;
    items.push({ key, size, lastModified });
  }
  return items;
}

export async function putBucketCorsR2(cfg, _allowedOrigins = []) {
  const xmlBody = [
    '<CORSConfiguration>',
    '  <CORSRule>',
    '    <AllowedOrigin>*</AllowedOrigin>',
    '    <AllowedMethod>GET</AllowedMethod>',
    '    <AllowedMethod>PUT</AllowedMethod>',
    '    <AllowedMethod>POST</AllowedMethod>',
    '    <AllowedMethod>DELETE</AllowedMethod>',
    '    <AllowedMethod>HEAD</AllowedMethod>',
    '    <AllowedHeader>*</AllowedHeader>',
    '    <ExposeHeader>ETag</ExposeHeader>',
    '    <MaxAgeSeconds>3600</MaxAgeSeconds>',
    '  </CORSRule>',
    '</CORSConfiguration>',
  ].join('\n');

  const buf = Buffer.from(xmlBody, 'utf8');
  return signedS3Fetch(cfg, {
    method: 'PUT',
    query: { cors: '' },
    body: buf,
    headers: {
      'Content-Type': 'application/xml',
      'Content-MD5': md5Base64(buf),
    },
  });
}

export async function createMultipartUploadR2(
  cfg,
  { key, contentType = 'video/mp4', cacheControl = 'public, max-age=31536000, immutable' }
) {
  const response = await signedS3Fetch(cfg, {
    method: 'POST',
    key,
    query: { uploads: '' },
    body: Buffer.alloc(0),
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    },
  });
  const xml = await response.text();
  const uploadId = extractXmlTag(xml, 'UploadId');
  if (!uploadId) {
    throw new Error('Cloudflare R2 did not return an UploadId for multipart upload.');
  }
  return uploadId;
}

export async function completeMultipartUploadR2(cfg, { key, uploadId, parts = [] }) {
  if (!uploadId || !Array.isArray(parts) || parts.length === 0) {
    throw new Error('uploadId and uploaded parts are required to complete multipart upload.');
  }
  const sorted = [...parts].sort((a, b) => Number(a.partNumber) - Number(b.partNumber));
  const partTags = sorted
    .map((p) => {
      const num = Number(p.partNumber);
      const rawEtag = String(p.etag || '').trim().replace(/^"+|"+$/g, '');
      if (!num || !rawEtag) {
        throw new Error(`Missing ETag for uploaded part ${num || '?'}. Ensure R2 CORS exposes the ETag header.`);
      }
      return `<Part><PartNumber>${num}</PartNumber><ETag>"${rawEtag}"</ETag></Part>`;
    })
    .join('');

  const xmlBody = `<CompleteMultipartUpload>${partTags}</CompleteMultipartUpload>`;
  await signedS3Fetch(cfg, {
    method: 'POST',
    key,
    query: { uploadId: String(uploadId) },
    body: Buffer.from(xmlBody, 'utf8'),
    headers: {
      'Content-Type': 'application/xml',
    },
  });
  return true;
}

export async function abortMultipartUploadR2(cfg, { key, uploadId }) {
  if (!key || !uploadId) return false;
  await signedS3Fetch(cfg, {
    method: 'DELETE',
    key,
    query: { uploadId: String(uploadId) },
  });
  return true;
}
