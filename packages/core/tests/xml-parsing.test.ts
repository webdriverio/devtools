import { describe, it, expect } from 'vitest'
import { xmlToJSON } from '../src/locators/xml-parsing.js'

describe('xmlToJSON', () => {
  it('parses valid Android XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.FrameLayout bounds="[0,0][1080,1920]"
    class="android.widget.FrameLayout">
    <android.widget.Button bounds="[100,200][300,400]" text="Submit"
      class="android.widget.Button" clickable="true"/>
  </android.widget.FrameLayout>
</hierarchy>`
    const result = xmlToJSON(xml)
    expect(result).not.toBeNull()
    expect(result!.tagName).toBe('hierarchy')
    expect(result!.children).toHaveLength(1)
    expect(result!.children[0].tagName).toBe('android.widget.FrameLayout')
    expect(result!.children[0].children[0].tagName).toBe(
      'android.widget.Button'
    )
  })

  it('parses valid iOS XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication>
  <XCUIElementTypeWindow>
    <XCUIElementTypeButton name="Login" label="Login" enabled="true"/>
  </XCUIElementTypeWindow>
</XCUIElementTypeApplication>`
    const result = xmlToJSON(xml)
    expect(result).not.toBeNull()
    expect(result!.tagName).toBe('XCUIElementTypeApplication')
  })

  it('survives HTML void elements — <link> without self-closure (issue #240)', () => {
    // iOS WebView page source can contain HTML <link> tags without /> close.
    // xmldom rejects these as "Opening and ending tag mismatch: link != head".
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication>
  <XCUIElementTypeWindow>
    <XCUIElementTypeWebView>
      <XCUIElementTypeOther>
        <head>
          <link rel="stylesheet" href="style.css">
          <meta charset="utf-8">
          <title>Test Page</title>
        </head>
      </XCUIElementTypeOther>
    </XCUIElementTypeWebView>
  </XCUIElementTypeWindow>
</XCUIElementTypeApplication>`
    const result = xmlToJSON(xml)
    expect(result).not.toBeNull()
  })

  it('survives bare ampersands in attribute values', () => {
    // URLs with query params contain bare & that xmldom rejects.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication>
  <XCUIElementTypeLink name="page?x=1&amp;y=2" label="A & B">
    <XCUIElementTypeStaticText value="foo & bar"/>
  </XCUIElementTypeLink>
</XCUIElementTypeApplication>`
    const result = xmlToJSON(xml)
    expect(result).not.toBeNull()
  })

  it('survives HTML void element <img> without self-closure', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication>
  <XCUIElementTypeWebView>
    <div>
      <img src="photo.png" alt="Photo">
      <br>
    </div>
  </XCUIElementTypeWebView>
</XCUIElementTypeApplication>`
    const result = xmlToJSON(xml)
    expect(result).not.toBeNull()
  })

  it('returns null for genuinely broken XML', () => {
    const xml = '<open><unclosed>text</open>'
    const result = xmlToJSON(xml)
    expect(result).toBeNull()
  })

  it('keeps properly self-closed void elements unchanged', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <container>
    <br/>
    <img src="a.png"/>
    <hr/>
    <input type="text" value="hi"/>
  </container>
</root>`
    const result = xmlToJSON(xml)
    expect(result).not.toBeNull()
    // <container> should have 4 element children
    const container = result!.children[0]
    expect(container!.children).toHaveLength(4)
  })
})
