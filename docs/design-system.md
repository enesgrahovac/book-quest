# Book Quest Design System

## Principles

1. **Vanilla CSS only** — No CSS-in-JS, no Tailwind. All styles live in `app/globals.css`.
2. **Token-first** — Every color, spacing value, radius, and shadow is a CSS custom property in `:root`. Components reference tokens, never raw values.
3. **Single source of truth** — `app/globals.css` is the only stylesheet. No component-scoped CSS modules.
4. **Mobile-first with 760px breakpoint** — Base styles target mobile; `@media (max-width: 760px)` handles overrides for narrow viewports.

## Token Reference

### Colors

| Token               | Value       | Usage                        |
| -------------------- | ----------- | ---------------------------- |
| `--bg`               | `#f3f2ed`   | Page background base         |
| `--panel`            | `#ffffff`   | Card / surface backgrounds   |
| `--text`             | `#1f2937`   | Primary text                 |
| `--muted`            | `#4b5563`   | Secondary / body text        |
| `--accent`           | `#0f766e`   | Primary brand (teal)         |
| `--accent-light`     | `#14b8a6`   | Lighter accent for hover     |
| `--accent-lighter`   | `#d8f1ed`   | Very light accent for fills  |
| `--accent-dark`      | `#0d6560`   | Darker accent for pressed    |
| `--border`           | `#d6e4e2`   | Default borders              |
| `--border-light`     | `#cce2df`   | Subtle borders               |
| `--border-input`     | `#c8d5d2`   | Input field borders          |
| `--success-bg/border/text` | green tones | Success feedback       |
| `--error-bg/border/text`   | red tones   | Error feedback         |
| `--warning-bg/border/text` | amber tones | Warning/info feedback  |

### Spacing

4px base scale. Use `var(--space-N)` where N maps to multiples of 4px:

| Token        | Value     |
| ------------ | --------- |
| `--space-1`  | `0.25rem` |
| `--space-2`  | `0.5rem`  |
| `--space-3`  | `0.75rem` |
| `--space-4`  | `1rem`    |
| `--space-5`  | `1.25rem` |
| `--space-6`  | `1.5rem`  |
| `--space-8`  | `2rem`    |
| `--space-10` | `2.5rem`  |
| `--space-12` | `3rem`    |
| `--space-16` | `4rem`    |

### Typography

| Token              | Value                                  |
| ------------------ | -------------------------------------- |
| `--font-body`      | IBM Plex Sans stack                    |
| `--font-mono`      | IBM Plex Mono stack                    |
| `--text-xs`        | `0.78rem`                              |
| `--text-sm`        | `0.85rem`                              |
| `--text-base`      | `0.95rem`                              |
| `--text-lg`        | `1.1rem`                               |
| `--text-xl`        | `1.4rem`                               |
| `--text-2xl`       | `clamp(1.8rem, 4vw, 2.7rem)`          |
| `--leading-tight`  | `1.25`                                 |
| `--leading-normal` | `1.55`                                 |
| `--leading-relaxed`| `1.7`                                  |
| `--weight-normal`  | `400`                                  |
| `--weight-medium`  | `500`                                  |
| `--weight-semibold`| `600`                                  |
| `--weight-bold`    | `700`                                  |

### Radii

| Token          | Value  | Usage              |
| -------------- | ------ | ------------------ |
| `--radius-sm`  | `6px`  | Sharpened corners  |
| `--radius-md`  | `10px` | Buttons, inputs    |
| `--radius-lg`  | `12px` | Chat panel, cards  |
| `--radius-xl`  | `16px` | Hero, formCard     |

### Shadows

| Token            | Usage                     |
| ---------------- | ------------------------- |
| `--shadow-sm`    | Subtle elevation          |
| `--shadow-md`    | Cards, hero               |
| `--shadow-lg`    | Modals, popovers          |
| `--shadow-focus` | Focus ring (accent-tinted)|

### Transitions

| Token               | Value                            |
| -------------------- | -------------------------------- |
| `--duration-fast`    | `120ms`                          |
| `--duration-normal`  | `200ms`                          |
| `--ease-out`         | `cubic-bezier(0.16, 1, 0.3, 1)` |

## Component Patterns

| Class              | Purpose                                                |
| ------------------ | ------------------------------------------------------ |
| `.page`            | Centered max-width container with vertical padding     |
| `.hero`            | Gradient card at top of page with eyebrow + heading    |
| `.formCard`        | White card below hero for forms / content              |
| `.buttonRow`       | Flex row for button groups (stacks on mobile)          |
| `.chatPanel`       | Scrollable message area with auto-scroll support       |
| `.chatMessage`     | Individual message bubble (use with `.assistantBubble` or `.userBubble`) |
| `.answerComposer`  | Grid container for textarea + button row               |
| `.chatEmptyState`  | Centered placeholder when chat has no messages         |
| `.typingIndicator` | Animated dots shown while waiting for AI response      |
| `.knownGapsCard`   | Warning-styled card listing missing information        |
| `.errorBox`        | Error banner with icon (for inline errors)             |
| `.errorText`       | Simple red text (legacy, used in state editor)         |
| `.successBox`      | Green-bordered success feedback card                   |
| `.btnSecondary`    | Outlined button variant (accent border, transparent bg)|
| `.ctaLink`         | Anchor styled as primary button                        |
| `.ghostLink`       | Anchor styled as outlined/ghost button                 |

## Adding New Styles

1. Define any new values as tokens in `:root` first.
2. Add the component class in `globals.css` (alphabetical within its section if possible).
3. Reference only tokens — never hardcode colors, spacing, or radii in component rules.
4. If the component needs responsive behavior, add rules inside the existing `@media (max-width: 760px)` block.

## For AI Agents

- **Token location:** All design tokens are in `:root` at the top of `app/globals.css`.
- **Composing new UI:** Combine existing component classes (`.page`, `.hero`, `.formCard`, `.buttonRow`) as building blocks. Add new classes only when no existing pattern fits.
- **Semantic colors:** Use `--success-*`, `--error-*`, `--warning-*` triples for feedback states.
- **Spacing:** Always use `var(--space-N)` for padding, margin, and gap values.
- **Typography:** Use `var(--text-*)` for font sizes, `var(--weight-*)` for font weights, `var(--font-body)` or `var(--font-mono)` for font families.
- **Do not** create separate CSS files, CSS modules, or inline styles.
