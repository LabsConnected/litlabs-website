---
description: Audit all Studio controls for accessibility — type=button, pointer-events-none, aria-labels, touch targets
---

1. Search for all `<button` elements missing `type="button"` in `src/app/studio/`:
   ```powershell
   rg -n "<button" src/app/studio/ --glob "*.tsx" | rg -v "type=.button."
   ```

2. Search for SVG/icon components inside buttons missing `pointer-events-none`:
   ```powershell
   rg -n "<(svg|[A-Z][a-zA-Z]+).+size=" src/app/studio/ --glob "*.tsx" | rg -v "pointer-events-none"
   ```

3. Search for icon-only buttons missing `aria-label`:
   ```powershell
   rg -n "<button" src/app/studio/ --glob "*.tsx" | rg -v "aria-label"
   ```

4. Check touch targets are at least 40px (h-10/w-10 or h-9/w-9 minimum):
   ```powershell
   rg -n "h-7 w-7|h-8 w-8|p-1\.5|h-6 w-6" src/app/studio/ --glob "*.tsx"
   ```

Fix every issue found. Do not skip any file.
