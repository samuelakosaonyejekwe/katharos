# Katharos

Katharos helps people buying property in Cyprus understand their Land Registry search, in their own language. The report itself comes from the advocate who acts for them.

**Live app:** https://samuelakosaonyejekwe.github.io/katharos/

## Who can use what

| Who | What they get |
|---|---|
| **Everyone** | A public site with an introduction, a guide, a glossary of Land Registry terms in 12 languages, live market data (ECB exchange rates, Eurostat house prices, property news) and install help. |
| **Buyers** | The buyer portal. A buyer opens the encrypted link their lawyer sends to see the report, timeline, key dates and glossary, and to send questions to the lawyer. No account is needed. The link can be protected with a PIN, and the report stays readable offline. |
| **Licensed law firms** | **Katharos Desk**, the lawyer workbench. It opens only with a licence key issued by Katharos, and then with the firm's own vault passphrase on each device. |

Languages: English, Greek, Turkish, Hebrew, French, Chinese, Arabic, Portuguese, Spanish, Italian, Russian and Ukrainian. Hebrew and Arabic use a right-to-left layout.

## Privacy and security

- **Firm data stays on the firm's device.** Matters and documents are encrypted with AES-256-GCM, using a key derived from the firm's passphrase. Nothing is uploaded unless the firm connects its own integrations.
- **Buyer reports have no server.** A buyer report travels inside its link's `#fragment`, which browsers never send to a server.
- **Licences can't be forged from the app.** Keys are signed with ECDSA P-256; the app holds only the public key.
- **Firm services need a firm token.** AI reading, cloud OCR and messaging go through each firm's own EU gateway, which requires that firm's token.
- **The app is hardened against injected content.** It sets a strict Content Security Policy and never inserts text as HTML.

## Works offline and keeps running

Katharos is an installable web app for computers, Android phones and iPhones. After the first visit it runs from the device, including in airplane mode. It also keeps working if the website host is unreachable, and it updates itself in the background when a new version is published.

## Develop

```bash
npm install
npm run dev       # local development server
npm test          # unit tests
npm run build     # static site in dist/
```
