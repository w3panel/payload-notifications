const encoder = new TextEncoder()

const hmac = async (algorithm: 'SHA-1' | 'SHA-256', secret: string, data: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
}

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const toHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * Twilio request signature: base64 HMAC-SHA1 of the full URL followed by each
 * POST parameter name and value, sorted by name.
 */
export const twilioSignature = async (
  authToken: string,
  url: string,
  params: URLSearchParams,
): Promise<string> => {
  const data = [...params.keys()]
    .sort()
    .reduce((acc, key) => acc + key + params.getAll(key).join(''), url)
  return toBase64(await hmac('SHA-1', authToken, data))
}

export const verifyTwilioSignature = async (
  authToken: string,
  url: string,
  params: URLSearchParams,
  signature: string | null,
) => Boolean(signature) && safeEqual(await twilioSignature(authToken, url, params), signature!)

/** Meta `X-Hub-Signature-256`: `sha256=` + hex HMAC-SHA256 of the raw body. */
export const metaSignature = async (appSecret: string, rawBody: string) =>
  `sha256=${toHex(await hmac('SHA-256', appSecret, rawBody))}`

export const verifyMetaSignature = async (
  appSecret: string,
  rawBody: string,
  signature: string | null,
) => Boolean(signature) && safeEqual(await metaSignature(appSecret, rawBody), signature!)
