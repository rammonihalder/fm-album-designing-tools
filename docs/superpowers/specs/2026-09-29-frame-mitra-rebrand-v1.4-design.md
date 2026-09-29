# Frame Mitra Rebrand v1.4 Design

## Goal

Rebrand the direct-distribution Photoshop UXP plugin from its current MM Album Design Tools presentation to the exact user-visible product values **FRAME MITRA**, **FM Album Designing Tools**, version **1.4.0**, and developer credit **Developed by Hridita Innovations**, while preserving existing customer licensing and storage compatibility.

## Scope and constraints

- Change user-visible product branding, accessible text, purchase copy, developer attribution, manifest display name, and current-release version text.
- Keep the plugin ID exactly `in.memorymaker.albumplacer`.
- Keep the signed token protocol exactly `MM1` and preserve the server licensing contracts, public key, key ID, API URLs, activation/refresh/trial behavior, device identity behavior, and trial state behavior.
- Keep secure-storage keys including `mm_license_signed_token_v1`, `mm_license_metadata_v1`, `mm_license_device_id_v1`, and other technical `mm_*` persistence keys unchanged.
- Do not modify backend/server code.
- New page files use `FMRLT<n>`; serial scanning recognizes both `MMRLT<n>` and `FMRLT<n>` across supported page extensions and must never overwrite an existing file.
- Do not commit, merge, tag, deploy, or package during this task.

## Design

### User-visible branding boundary

The UI, manifest display name, licensing messages, purchase message, developer footer, Photoshop command labels, accessible labels, placed-layer labels, generated edited-photo names, and product-brand log prefixes will use the Frame Mitra values. The exact developer credit is `Developed by Hridita Innovations`. The exact purchase message is:

`I want to buy a license for FM Album Designing Tools.`

The visible phone number remains `7001514367`, and the WhatsApp target remains `917001514367`.

Product-brand strings in README and current-release documentation will be updated to v1.4.0. Filesystem paths, technical compatibility examples, historical reference source, and identifiers will remain unchanged unless they are explicitly user-visible current branding.

### Page filename compatibility

The page save module will separate the new output prefix from recognition of historical files. Its generator will use `FMRLT`, while its serial extractor will accept either `MMRLT` or `FMRLT` with optional sanitized prefixes and `.psd`, `.jpg`, or `.jpeg` extensions. The next serial will be computed from all recognized names in both destination folders, so `MMRLT8` plus `FMRLT10` yields `FMRLT11`. Existing names remain untouched and collision checks continue before file creation.

### Licensing compatibility

No license protocol or persistence implementation will be renamed. Tests will assert the unchanged plugin ID, `MM1` token shape, secure-storage keys, v1.3 paid-license compatibility, and trial behavior. Only user-facing license copy and log prefixes will change.

## Verification

Focused tests will cover the exact panel/header/license/footer strings, manifest name/version, visible version, runtime `PLUGIN_VERSION`, purchase message and WhatsApp URL, compatibility identifiers, mixed old/new serial scanning, new `FMRLT` generation, and collision safety. The complete suite will then run with `node --test`; results and Git status will be reported without creating a commit.
