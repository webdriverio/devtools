import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  FIXTURE_MAX_BODY_BYTES,
  FIXTURE_PASSWORD,
  FIXTURE_USERNAME
} from '../smoke/constants.js'
import { startFixtureSite, type FixtureSite } from '../smoke/fixture-site.js'

let site: FixtureSite

beforeAll(async () => {
  site = await startFixtureSite(0)
})

afterAll(async () => {
  await site.close()
})

/** A cookie-carrying client, so the flow reads the way a browser drives it. */
function browserLike() {
  const jar = new Map<string, string>()
  async function request(pathname: string, init: RequestInit = {}) {
    const res = await fetch(`${site.url}${pathname}`, {
      ...init,
      redirect: 'manual',
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
      }
    })
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';')
      const [name, value] = pair!.split('=')
      if (value) {
        jar.set(name!, value)
      } else {
        jar.delete(name!)
      }
    }
    return res
  }
  async function follow(pathname: string, init?: RequestInit) {
    let res = await request(pathname, init)
    while (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')!
      res = await request(location)
      pathname = location
    }
    return { url: pathname, html: await res.text(), status: res.status }
  }
  const login = (username: string, password: string) =>
    follow('/authenticate', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }).toString()
    })
  return { follow, login }
}

describe('fixture site', () => {
  it('serves a home page with the-internet title and a heading', async () => {
    const { html, status } = await browserLike().follow('/')
    expect(status).toBe(200)
    expect(html).toContain('<title>The Internet</title>')
    expect(html).toContain('<h1 class="heading">')
  })

  it('serves the login form the examples drive', async () => {
    const { html } = await browserLike().follow('/login')
    for (const marker of [
      'id="login"',
      'id="username"',
      'id="password"',
      'type="submit"',
      '<h2>Login Page</h2>'
    ]) {
      expect(html).toContain(marker)
    }
    expect(html).not.toContain('id="flash"')
  })

  it('logs in, shows the secure area once, and logs out', async () => {
    const client = browserLike()
    const secure = await client.login(FIXTURE_USERNAME, FIXTURE_PASSWORD)
    expect(secure.url).toBe('/secure')
    expect(secure.html).toContain('You logged into a secure area!')
    expect(secure.html).toMatch(
      /<a class="button[^"]*" href="\/logout">.*Logout/
    )

    const again = await client.follow('/secure')
    expect(again.html).toContain('Secure Area')
    expect(again.html).not.toContain('id="flash"')

    const out = await client.follow('/logout')
    expect(out.url).toBe('/login')
    expect(out.html).toContain('You logged out of the secure area!')

    const locked = await client.follow('/secure')
    expect(locked.url).toBe('/login')
    expect(locked.html).toContain('You must login to view the secure area!')
  })

  it('names the wrong field on a failed login', async () => {
    const badUser = await browserLike().login('foobar', 'barfoo')
    expect(badUser.url).toBe('/login')
    expect(badUser.html).toContain('Your username is invalid!')

    const badPassword = await browserLike().login(FIXTURE_USERNAME, 'nope')
    expect(badPassword.html).toContain('Your password is invalid!')
  })

  it.each(['//login', '/login/', '//login?next=%2F'])(
    'serves the login page for %s, as a base URL with a trailing slash produces',
    async (pathname) => {
      const res = await fetch(`${site.url}${pathname}`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('<h2>Login Page</h2>')
    }
  )

  it('refuses a login body over the byte limit', async () => {
    const res = await fetch(`${site.url}/authenticate`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `username=${'\u00e9'.repeat(FIXTURE_MAX_BODY_BYTES / 2 + 1)}`
    }).catch((err: unknown) => err)
    if (res instanceof Response) {
      expect(res.status).toBe(400)
    } else {
      expect(res).toBeInstanceOf(Error)
    }
  })

  it('answers an unknown path with 404', async () => {
    const res = await fetch(`${site.url}/nope`)
    expect(res.status).toBe(404)
  })
})
