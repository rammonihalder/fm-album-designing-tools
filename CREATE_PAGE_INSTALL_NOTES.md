# Create Album / Create Page feature

Copy these changed files into the existing plugin project, preserving paths:

- `index.html`
- `main.js`
- `style.css`
- `manifest.json`
- `README.md`
- `src/tools/createPage.js` (new)
- `tests/createPage.test.js` (new, optional for development)

## Presets

- Album 12 x 36: 10800 x 3600 px, 300 DPI, white, album guides
- Album 12 x 18: 5400 x 3600 px, 300 DPI, white, album guides
- Instagram Post: 1080 x 1080 px, 300 DPI
- Facebook Post: 1200 x 1500 px, 300 DPI
- YouTube Thumbnail: 1280 x 720 px, 300 DPI
- Custom: inch or pixel dimensions, 300 DPI fixed, White/Black/Transparent background

## Album guides

For album presets only:

- Outer safe margin: 0.25 inch on all four sides
- Center fold guide
- Center safe-zone guides: 0.25 inch on either side of the fold (0.50 inch total)

The feature is routed through the existing license guard and global running/button lock.
