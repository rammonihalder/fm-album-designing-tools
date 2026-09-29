FM Album Designing Tools v1.4.0 DEV UI Fix

Changes:
- Moves CREATE ALBUM section below the existing 8-tool action grid.
- Replaces CSS Grid preset layout with UXP-friendly Flexbox rows.
- Keeps DEV license bypass enabled for testing only.
- Keeps Create Page presets and album guide logic unchanged.

Install for development testing:
1. Copy index.html, style.css, main.js and src/tools/createPage.js into the current v1.2 development project, preserving paths.
2. Reload the plugin in Adobe UXP Developer Tool.
3. Click CREATE PAGE. Six presets should now appear in three 2-column rows.
4. Test 12 × 36 first.

DO NOT package this DEV build as the production CCX because license bypass is enabled.
