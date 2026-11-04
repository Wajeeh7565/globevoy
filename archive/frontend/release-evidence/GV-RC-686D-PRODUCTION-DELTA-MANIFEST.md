# GV-RC-686D — Direct Production Delta

Production baseline: **GV-BOOK-685D-R1**  
Authenticated baseline ZIP SHA-256: `a01337ec4494a4a1bf907811b3f24da1fc2854f7b35cb3ca94a423b52b10736e`

This comparison is direct from 685D-R1 to the final 686D runtime. It is not an intermediate-release comparison.

## Summary

- Changed runtime files: **21**
- Added runtime files: **5**
- Removed runtime files: **0**
- Backend files: **0**
- Lambda files: **0**
- Runtime-server/serverless deployment files: **0**

The existing browser `runtime/` directory is frontend configuration/data and is unchanged; it is not a server runtime.

## Changed runtime files

| File | 686D SHA-256 | 685D-R1 SHA-256 |
|---|---|---|
| `about.html` | `560cf87428a22af6d047c093bf86a0749a14818cc02922ffaa307b034f1318d9` | `b5cf02c772ea2aa934a4c31b6ed92126f3f1bf04486560f6cf90984c74099c30` |
| `booking.html` | `09279fafc90d27b0ef5be77c5d7b771db08a021e20d56d494d828e14f51bd222` | `72ed9d5bfc653f42a143d012cd64a565d5ae31fa9c2b78f1d8b131340ae15b85` |
| `create-account.html` | `5443bedb2636af8ae28749544475d5e884fbfe0baae1aee4977a6a371931d570` | `bfae36176f0d343573c9744ed630e92be3bc153f3ca18d7b044e85645d038fc1` |
| `explore.html` | `c2feba2044d7f02382343c80d6616d9b442206cae162c404869c02be6baa27bd` | `b36fa21101d85f2d2948391f40a2c695ab81ecd4b0522f297990eda7dc2a927f` |
| `how-it-works.html` | `22795dfb5eeb17832c855c7198edc6c6336970f79e792ab2d4eca70e0fee26e6` | `a5f2c63941c00c218b5845c8b912e278d81dcfe317c0bd51db61112f019de4ea` |
| `index.html` | `3da3f5a64a12fdea8d9b2d9be0faa6ada29768214375e1f635150560666c2cbd` | `63ed99a0cda4d2be56df4f04f73cec9092defd37430a964126b28752b4395193` |
| `mixed-results.html` | `d2bbd202ce0b0d43a02608bda288d679179dd7a1223c69c2c7db75db7d07261a` | `18ffb56a029c0682ddcf6a0395ce4adf6f487b0ce499350a5ff56f0ce89ac043` |
| `multi-city-trip.html` | `da3960f0aaaa0ba9cf4e1a14f34c878484dfc773d2cd90ba0ab70f318599635a` | `b7940aa983c87d01c09a888bdf7c8d20299d5cb427fca01cc94178b153aade56` |
| `multi-city.html` | `87f11ee7daa98d50c3ff75fc6be22fa0399b9ddc2370535b4488594a8bd50b13` | `fb785c814456d54dbb8e5789f156df0088fede93272961a4734b65bd989db7fb` |
| `multicity-visualizer.html` | `a05d7d81c55423a2c8c919484aa13ce97aab0181654530a534649842abad8ab2` | `56361d8d330a2dc8d46fa32c3e2d084a6942830560566338a72882ba00bee1b6` |
| `saved-trips.html` | `04484bc3c347e20c55cc5f1c1736921c260ecf66d7a63e22d7735181dfb41cfb` | `2ad6eb5d426b7ffa557abe9edc84d185677a1cc0ee272671d26154de8cd91514` |
| `scripts/booking-hub-685d.js` | `6344ffad400d52dbce0d5d104ea41b86e6bd39394377e028936ba5be7809236a` | `a44d4baeb2ab397703e48e16ee7e4833e317657703750591ff105dbf60e9f211` |
| `scripts/mixed-results-674a.js` | `d2d9f852930002b95371da06534dffe2ddef0a6bd5703fc183b581fa9ee67ee5` | `1d6def6bf0827adee8ee14e5ce234ecd09a0e52d9b90696ac8cccf9c4fa73af8` |
| `scripts/multi-city-live.js` | `6a3b53ee28a6d85429ee88c0fd66f7f443d24ec13a4a219b596c0ae7f46d586e` | `8d1abcd9f06bb83561595803427c89ccb0c2d2f4e54f348d05f0f1ca89db2350` |
| `scripts/multi-city-trip-673a.js` | `9abba792a47e3c1fee594ca1e405091904124fcee8c1d666f1c87b49fbb828b3` | `3abcb88a403eadc6cb7fcf8ef907c5e95f682980a600987ae4ae1776fb54bf6f` |
| `scripts/multicity-visualizer-674a.js` | `7013b0777f21acddf9c01749fe035691f21d89101d81e84a6b7ed1627ca55dd4` | `4f8705b65d44e276b1502fd35d110af1a15c7e09b98a95753911ef78e4d8ba17` |
| `scripts/shell-670f.js` | `d7b116c408093d40b41b651818068cc29c9578df9ab0a20956eaa91c9cafc6df` | `8430039894d5b7c32405f356c796695f1fe0586e6f862f118d0bc5446746a0c1` |
| `sign-in.html` | `a49c40a8bdb7750ab1446d609b49340d993bf23ed470ab1cb922f4709ccbe2ba` | `886360638677b47bc0cad81cfde08da289383e550082f2d8540edfa456991121` |
| `styles/shell.css` | `d705375cd9c872cbeec189399cf84202d93ab8581dc0932c2531f3b25de09551` | `45d0ff062897b2f89a795aa32c6d1814d814e85cc8f5bdd1ebf63367459bb52a` |
| `trip.html` | `cfe517b3085d664663fc16fc515095601c1f340a1b69c2e71e43204c8b32cd5c` | `3ca45c8cdca1b80438fbe38664d12b56c9d5ddf577db19de0dfdc26f2bc0bb98` |
| `trust.html` | `dafe9ca4b2cc851d75a234a09480d3f50f55ce86a3f55ff5cf4ce829c422b9b4` | `c33fa0a9a1b80674faa4ae0d5c6728adac70f11919a912131cef9be8e052cdd8` |

## Added runtime files

| File | SHA-256 |
|---|---|
| `scripts/booking-workspace-686c.js` | `ce9ac87a8cd091becf202bf25edc3e0364025b88690a478e365ad9982fafce01` |
| `scripts/journey-experience-686b.js` | `d7b80b586b69e8fc1718dc8f6a785cb30fa11c77e49b79f6c2660f4bdbac0ef7` |
| `styles/booking-workspace-686c.css` | `95e5bb1da652d65016bed4a484b7b32cc25f8f1327ab414dfb8afa8f89184fa2` |
| `styles/journey-experience-686b.css` | `e5b26ba9c0584be7f4119f229bb57a840d3ed3966f92e3aba328ebacd0ac2998` |
| `styles/product-info-686a.css` | `1dc437494912eb98ac69a4819185be28dbc0ff17d03f6fc541bfa2ba7ed3a021` |

## Removed runtime files

None.

## Unchanged legal-content files

`privacy.html`, `terms.html` and `affiliate.html` are byte-identical to 685D-R1. Their shared navigation context may change through shell routing, but their content was not rewritten. See `GV-RC-686D-LEGAL-COMMERCIAL-GATE.md`.

