// Mirrors the-internet.herokuapp.com's login flow so the examples smoke job depends on no third-party site.

import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  FIXTURE_DEFAULT_HOST,
  FIXTURE_MAX_BODY_BYTES,
  FIXTURE_PASSWORD,
  FIXTURE_USERNAME
} from './constants.js'

const SESSION_COOKIE = 'fixture_session'
const FLASH_COOKIE = 'fixture_flash'

const FLASHES = {
  loggedIn: { kind: 'success', text: 'You logged into a secure area!' },
  loggedOut: { kind: 'success', text: 'You logged out of the secure area!' },
  badUsername: { kind: 'error', text: 'Your username is invalid!' },
  badPassword: { kind: 'error', text: 'Your password is invalid!' },
  mustLogin: { kind: 'error', text: 'You must login to view the secure area!' }
} as const

type FlashKey = keyof typeof FLASHES

interface Reply {
  status: number
  headers: Record<string, string | string[]>
  body: string
}

function isFlashKey(value: string | undefined): value is FlashKey {
  return (
    value !== undefined && Object.prototype.hasOwnProperty.call(FLASHES, value)
  )
}

function readCookies(req: IncomingMessage): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) {
      cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
    }
  }
  return cookies
}

function cookie(name: string, value: string): string {
  return value
    ? `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`
    : `${name}=; Path=/; Max-Age=0`
}

function page(title: string, content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
</head>
<body>
  <div class="row">
    <div id="flash-messages" class="large-12 columns"></div>
  </div>
  <div class="row">
    <div id="content" class="large-12 columns">
${content}
    </div>
  </div>
</body>
</html>
`
}

function flashMarkup(key: FlashKey | undefined): string {
  if (!key) {
    return ''
  }
  const { kind, text } = FLASHES[key]
  return `<div id="flash" class="flash ${kind}">${text}<a href="#" class="close">x</a></div>`
}

function html(body: string, flashConsumed: boolean): Reply {
  return {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...(flashConsumed ? { 'set-cookie': cookie(FLASH_COOKIE, '') } : {})
    },
    body
  }
}

function redirect(location: string, cookies: string[]): Reply {
  return {
    status: 303,
    headers: { location, 'set-cookie': cookies },
    body: ''
  }
}

function homePage(): string {
  return page(
    'The Internet',
    `      <h1 class="heading">Welcome to the-internet</h1>
      <h2>Available Examples</h2>
      <ul>
        <li><a href="/login">Form Authentication</a></li>
      </ul>`
  )
}

function loginPage(flash: FlashKey | undefined): string {
  return page(
    'The Internet',
    `      ${flashMarkup(flash)}
      <div class="example">
        <h2>Login Page</h2>
        <h4 class="subheader">Use ${FIXTURE_USERNAME} and ${FIXTURE_PASSWORD} to log in.</h4>
        <form name="login" id="login" action="/authenticate" method="post">
          <div class="row"><div class="large-6 small-12 columns">
            <label for="username">Username</label>
            <input type="text" name="username" id="username">
          </div></div>
          <div class="row"><div class="large-6 small-12 columns">
            <label for="password">Password</label>
            <input type="password" name="password" id="password">
          </div></div>
          <button class="radius" type="submit"><i class="fa fa-2x fa-sign-in"> Login</i></button>
        </form>
      </div>`
  )
}

function securePage(flash: FlashKey | undefined): string {
  return page(
    'The Internet',
    `      ${flashMarkup(flash)}
      <div class="example">
        <h2><i class="icon-lock"></i> Secure Area</h2>
        <h4 class="subheader">Welcome to the Secure Area. When you are done click logout below.</h4>
        <a class="button secondary radius" href="/logout"><i class="icon-2x icon-signout"> Logout</i></a>
      </div>`
  )
}

function authenticate(form: URLSearchParams): Reply {
  if (form.get('username') !== FIXTURE_USERNAME) {
    return redirect('/login', [
      cookie(SESSION_COOKIE, ''),
      cookie(FLASH_COOKIE, 'badUsername')
    ])
  }
  if (form.get('password') !== FIXTURE_PASSWORD) {
    return redirect('/login', [
      cookie(SESSION_COOKIE, ''),
      cookie(FLASH_COOKIE, 'badPassword')
    ])
  }
  return redirect('/secure', [
    cookie(SESSION_COOKIE, FIXTURE_USERNAME),
    cookie(FLASH_COOKIE, 'loggedIn')
  ])
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > FIXTURE_MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// A base URL with a trailing slash yields `//login`, which URL parsing would read as a host.
function normalisePath(url: string): string {
  const [path = '/'] = url.split(/[?#]/)
  return path.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1')
}

/** Routes one request; exported so the routing is testable without a socket. */
export async function route(req: IncomingMessage): Promise<Reply> {
  const pathname = normalisePath(req.url ?? '/')
  const cookies = readCookies(req)
  const flashCookie = cookies.get(FLASH_COOKIE)
  const flash = isFlashKey(flashCookie) ? flashCookie : undefined
  const loggedIn = cookies.get(SESSION_COOKIE) === FIXTURE_USERNAME

  if (req.method === 'POST' && pathname === '/authenticate') {
    return authenticate(new URLSearchParams(await readBody(req)))
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return { status: 405, headers: { allow: 'GET, HEAD, POST' }, body: '' }
  }
  switch (pathname) {
    case '/':
      return html(homePage(), false)
    case '/login':
      return html(loginPage(flash), flash !== undefined)
    case '/secure':
      return loggedIn
        ? html(securePage(flash), flash !== undefined)
        : redirect('/login', [cookie(FLASH_COOKIE, 'mustLogin')])
    case '/logout':
      return redirect('/login', [
        cookie(SESSION_COOKIE, ''),
        cookie(FLASH_COOKIE, 'loggedOut')
      ])
    default:
      return {
        status: 404,
        headers: { 'content-type': 'text/plain' },
        body: 'Not Found'
      }
  }
}

export interface FixtureSite {
  url: string
  server: Server
  close: () => Promise<void>
}

export function startFixtureSite(
  port = 0,
  host = FIXTURE_DEFAULT_HOST
): Promise<FixtureSite> {
  const server = createServer((req, res) => {
    route(req).then(
      (reply) => {
        res.writeHead(reply.status, reply.headers)
        res.end(req.method === 'HEAD' ? undefined : reply.body)
      },
      (err: unknown) => {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end(err instanceof Error ? err.message : String(err))
      }
    )
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const { port: bound } = server.address() as AddressInfo
      resolve({
        url: `http://${host}:${bound}`,
        server,
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((err) => (err ? fail(err) : done()))
          )
      })
    })
  })
}
