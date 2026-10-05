# Katharos

Katharos helps people buying property in Cyprus understand their Land Registry search in their own language. The report comes from the advocate who acts for them. Law firms, developers and banks use Katharos Desk to do the due diligence itself.

**Live app:** https://samuelakosaonyejekwe.github.io/katharos/

## Who can use what

| Who | What they get |
|---|---|
| **Everyone** | The public site: a guide, a glossary of Land Registry terms in 12 languages, live market data (ECB exchange rates, Eurostat house prices, property news), a free **Verify** tool that checks a report's fingerprint, and install help. |
| **Buyers** (free) | The buyer portal. A buyer opens the encrypted link their lawyer sends to see the report, timeline, key dates and glossary, and to send questions to the lawyer. No account is needed. The link can be protected with a PIN, and the report stays readable offline. |
| **Law firms** (licence) | Katharos Desk: matters, Greek certificate and contract reading, the rulebook checks, reports issued in the advocate's name in three languages, buyer links, deadline watch and an audit trail. |
| **Developers** (licence) | Katharos Desk to pre-check each unit's title and document pack, then export encrypted, fingerprinted packs for buyers' lawyers. |
| **Banks** (licence) | Katharos Desk to check collateral titles, import packs and watch for new entries before each drawdown. |

Languages: English, Greek, Turkish, Hebrew, French, Chinese, Arabic, Portuguese, Spanish, Italian, Russian and Ukrainian. Hebrew and Arabic use a right-to-left layout.

## How it runs

Everything runs in the user's own browser. There is no Katharos server.

**Integrations.** Each licensed organisation connects its own accounts in **Integrations**, and its browser calls the provider directly:

| Service | Provider |
|---|---|
| AI (second reading and explanations) | Claude on Amazon Bedrock, EU region |
| Cloud OCR | Azure Document Intelligence |
| Messaging | WhatsApp Business, Brevo email |

Free alternatives are built in:
- on-device Greek OCR
- the rule checks
- device WhatsApp and email links

**Licences** are sold through a licence store that handles billing and EU VAT, and the browser activates them directly.

**Hosting** is static and free. The app installs on computers, Android phones and iPhones and works offline, including in airplane mode.

## Security

- **Encryption:** data on each device is encrypted with AES-256-GCM, using a key derived from the user's passphrase. An optional passkey adds a second factor.
- **Records:**
  - The audit trail is hash-chained.
  - Every document and report is fingerprinted with SHA-256.
  - Buyer reports travel inside their link's `#fragment`, which browsers never send to a server.
- **Browser:** the app sets a strict Content Security Policy and never inserts text as HTML.

## Develop

```bash
npm install
npm run dev       # local development server
npm test          # unit tests, including the reader accuracy evaluation
npm run build     # static site in dist/
```
