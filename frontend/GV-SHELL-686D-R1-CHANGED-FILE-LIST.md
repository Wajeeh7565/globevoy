# GV-SHELL-686D-R1 — Changed-file list

Authoritative baseline: `frontend-staging-gv-rc-686d-consolidated-ux-release-candidate-portable.zip`

Baseline SHA-256: `cac8de2a870c4edca3393e358c6559d16a59607d473da43efd7e0b57ad10b3c4`

## Production runtime delta

- changed: **16 files**
- added: **0 runtime files**
- removed: **0 files**
- backend/Lambda/provider/runtime-server files: **0**

`scripts/shell-670f.js` removes primary navigation and mobile-menu construction while preserving the canonical home brand, honest local Travel profile action, and complete footer.

`styles/shell.css` removes navigation/menu presentation, reduces the header to 60 px, preserves Globevoy identity, and keeps accessible desktop/mobile focus and tap targets.

The fourteen HTML changes below are cache-key updates only: `?v=686a` → `?v=686d-r1` for the shared shell CSS and JavaScript.

| File | 686D SHA-256 | 686D-R1 SHA-256 |
|---|---|---|
| `about.html` | `560cf87428a22af6d047c093bf86a0749a14818cc02922ffaa307b034f1318d9` | `8abf9b488502184aed2ba6bbd48713f9ab995890ab20d487bef20940b9811f51` |
| `booking.html` | `09279fafc90d27b0ef5be77c5d7b771db08a021e20d56d494d828e14f51bd222` | `fdf15b58e66a871adb18525e0943caf3ef0084103b1b932280c31abc9e95be2b` |
| `create-account.html` | `5443bedb2636af8ae28749544475d5e884fbfe0baae1aee4977a6a371931d570` | `93b370a725a31280734a47b1d71df69c2ba7619c80538743878cb7936d9a185e` |
| `explore.html` | `c2feba2044d7f02382343c80d6616d9b442206cae162c404869c02be6baa27bd` | `e8e56105921ea5186622aedc3642932a82ebe5e4eb773bcd98d287d157bac570` |
| `how-it-works.html` | `22795dfb5eeb17832c855c7198edc6c6336970f79e792ab2d4eca70e0fee26e6` | `d292ed44e9c535d7c5da85af288578bb03c943519c582b82c3b6db2983ac1de3` |
| `index.html` | `3da3f5a64a12fdea8d9b2d9be0faa6ada29768214375e1f635150560666c2cbd` | `807f38665750d3b779be810c7dc777de5ac8b561392582b7af488cfa5949d8e4` |
| `mixed-results.html` | `d2bbd202ce0b0d43a02608bda288d679179dd7a1223c69c2c7db75db7d07261a` | `91206f6d45e54e0b602a8bedc5247eb3493dafadcc64c33353306f9c796253c5` |
| `multi-city-trip.html` | `da3960f0aaaa0ba9cf4e1a14f34c878484dfc773d2cd90ba0ab70f318599635a` | `72594f68eb0fc8112b6e6c2d46a6564b91c982e36a4d08d3128dcf18944b3fb3` |
| `multi-city.html` | `87f11ee7daa98d50c3ff75fc6be22fa0399b9ddc2370535b4488594a8bd50b13` | `ec6ca0e8ae2e5f6e5ed14033797659d3562b792c3013eaaa5f6b8c55ba66bae6` |
| `multicity-visualizer.html` | `a05d7d81c55423a2c8c919484aa13ce97aab0181654530a534649842abad8ab2` | `9003f72a2838c4237aab84369744048beb04710740e7f2e03b9944380406d05a` |
| `saved-trips.html` | `04484bc3c347e20c55cc5f1c1736921c260ecf66d7a63e22d7735181dfb41cfb` | `a5695c574e853cb54c3e467cba162a898cd635a46ede36037c25547cc9ee4317` |
| `sign-in.html` | `a49c40a8bdb7750ab1446d609b49340d993bf23ed470ab1cb922f4709ccbe2ba` | `de8049bb2a884e586bfb7619832279e26f6b8bd4b84fee68d68a293110c703c3` |
| `trip.html` | `cfe517b3085d664663fc16fc515095601c1f340a1b69c2e71e43204c8b32cd5c` | `d368f3efe66737fc4271e1037583be32f05bc73aa59b58e1eedd21dce690f86c` |
| `trust.html` | `dafe9ca4b2cc851d75a234a09480d3f50f55ce86a3f55ff5cf4ce829c422b9b4` | `b950f5c22cd8247dd9f88dac431971b08987587209c71bb4b805585953f3f313` |
| `scripts/shell-670f.js` | `d7b116c408093d40b41b651818068cc29c9578df9ab0a20956eaa91c9cafc6df` | `4d86b7ae7fd4d1119a852025174781029e9eada7bfcf994d37025d3f2d34f1b1` |
| `styles/shell.css` | `d705375cd9c872cbeec189399cf84202d93ab8581dc0932c2531f3b25de09551` | `17c834817a9e73dfea3ee585fb3b97d033ff77f561058f7a78a1d6b8389a8a51` |

## Validation/release artifacts

The package also adds the 686D-R1 validator, release metadata, validation report, rollback manifest, screenshots, and internal SHA-256 manifest. Four inherited validators were updated only where their intentionally superseded shell/hash assertions referred to the pre-R1 header.
