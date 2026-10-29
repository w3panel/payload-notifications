export type UnsubscribeClaims = {
  /** User ID. */
  u: string
  /** Category. */
  c: string
  /** Channel, or undefined for all channels. */
  ch?: string
}

const encoder = new TextEncoder()

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromBase64Url = (value: string): string =>
  atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4))

const hmac = async (secret: string, data: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data))))
}

/** Signed, URL-safe token for a one-click unsubscribe (Web Crypto; runs on Node and Workers). */
export const signUnsubscribeToken = async (secret: string, claims: UnsubscribeClaims) => {
  const body = toBase64Url(encoder.encode(JSON.stringify(claims)))
  return `${body}.${await hmac(secret, body)}`
}

/** Verifies a token; returns its claims or undefined when tampered or malformed. */
export const verifyUnsubscribeToken = async (
  secret: string,
  token: string,
): Promise<UnsubscribeClaims | undefined> => {
  const [body, signature] = token.split('.')
  if (!body || !signature) return undefined
  const expected = await hmac(secret, body)
  if (expected.length !== signature.length) return undefined
  let diff = 0
  for (let index = 0; index < expected.length; index++) {
    diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
  }
  if (diff !== 0) return undefined
  try {
    const bytes = Uint8Array.from(fromBase64Url(body), (char) => char.charCodeAt(0))
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as UnsubscribeClaims
    return typeof claims.u === 'string' && typeof claims.c === 'string' ? claims : undefined
  } catch {
    return undefined
  }
}

export const UNSUBSCRIBE_PATH = '/payload-notifications/unsubscribe'
