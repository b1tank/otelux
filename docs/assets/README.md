# Public media assets

All product media in this directory must use deterministic synthetic telemetry. Before committing an image or animation, inspect visible pixels and metadata for user names, home paths, host names, tokens, private endpoints, prompts, and production telemetry.

- `social-preview.png` is generated from the canonical desktop icon by `scripts/build-readme-assets.py`. It is the source file to upload under **Repository settings → General → Social preview**.
- The product screenshot and demo animation are intentionally absent until they can be captured from a clean OTelux profile through Deskpal and pass the privacy review above.

Regenerate the social preview on Linux with Pillow and `rsvg-convert` available:

```bash
python3 scripts/build-readme-assets.py
```
