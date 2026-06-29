# Game ROMs Directory

This directory contains ROM files for the retro games in LiTTree Game Cloud.

## Supported Platforms

- **NES** (Nintendo Entertainment System) - `.nes` files
- **SNES** (Super Nintendo) - `.smc` or `.sfc` files
- **Genesis** (Sega Genesis/Mega Drive) - `.bin` or `.md` files
- **Game Boy** - `.gb` files (coming soon)
- **Game Boy Advance** - `.gba` files (coming soon)

## Required ROM Files

Based on the game library configuration in `src/lib/games.ts`, you need:

### NES Games
- `smb1.nes` - Super Mario Bros. (1985)
- `tetris.nes` - Tetris (1989)

### SNES Games
- `smw.smc` - Super Mario World (1991)

### Genesis Games
- `sonic1.bin` - Sonic the Hedgehog (1991)

## How to Add ROMs

1. **Obtain ROM files legally** - You should only use ROM files for games you own.

2. **Place them in this directory** - Copy the ROM files directly into `/public/roms/`.

3. **Verify file names** - Make sure the filenames match exactly what's in the game configuration.

4. **Restart the dev server** - Next.js needs to detect the new static files.

## Controls (NES Games)

| Key | Action |
|-----|--------|
| Arrow Keys | D-Pad |
| Z | B Button |
| X | A Button |
| Enter | Start |
| Shift | Select |

Alternative keys:
- A = B Button
- S = A Button
- Space = Start
- C = Select

## Note on ROM Compatibility

The emulator uses the jsnes library which has good compatibility with most NES games. Some games with special mappers may not work correctly.

For SNES and Genesis, emulator support is coming soon (currently shows placeholder).

## Legal Notice

ROM files are not provided with this project. You must supply your own legally obtained ROM files. Dumping ROMs from cartridges you own is legal for personal use in most jurisdictions.
