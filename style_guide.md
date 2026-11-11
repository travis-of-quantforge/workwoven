# Workspace style guide

| Colour | Hex | Use |
|---|---|---|
| **Deep navy** | `#172B3A` | Main text, navigation, dark backgrounds |
| **Teal** | `#087F78` | Primary buttons, links, active tabs and logo |
| **Warm ivory** | `#F7F5F0` | Workspace background |
| **White** | `#FFFFFF` | Conversation panels, cards and documents |
| **Soft mint** | `#DDF1EA` | Gentle highlights and selected areas |
| **Coral** | `#E9826B` | Small brand accents and attention markers |

Use navy text on ivory, white and mint. Primary buttons use white text on teal.
Small text links use a darker teal shade for contrast on ivory and mint.
Reserve coral for small markers and tinted attention panels; use navy text rather
than white on coral. Borders and muted text use restrained navy tints. Keep focus
indicators visible and preserve distinct error states. AI advice retains its
existing dark-blue text to distinguish it from human messages.

The shared colour tokens live in `src/app/globals.css`. Hover colours are darker
teal shades; lighter teal shades derive from the mint highlight. Do not introduce
unrelated brand colours in individual screens.
