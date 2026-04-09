# dust2.cc

`dust2.cc` is a Chrome Manifest V3 extension for CS2 skin market analysis.

It currently targets:

- `steamdt.com`
- `csqaq.com`

The extension provides:

- a side panel with local and LLM-assisted analysis
- an inline in-page AI panel
- K-line based signal generation and indicator summaries
- chart-level key price annotations

## Current Status

This project is actively being iterated on.

Known work-in-progress area:

- `steamdt.com` main-chart K-line capture is still being stabilized

## Tech Stack

- TypeScript
- Vite
- React
- Chrome Extension Manifest V3
- Vitest

## Development

Install dependencies:

```bash
npm install
```

Start local development:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Type-check:

```bash
npm run typecheck
```

Build the extension:

```bash
npm run build
```

## Load In Chrome

1. Run `npm run build`
2. Open `chrome://extensions`
3. Enable Developer Mode
4. Click `Load unpacked`
5. Select the project `dist` directory

## Project Structure

- `src/content` - content scripts, extractors, page hooks, inline panel injection
- `src/background` - background service worker and LLM routing
- `src/sidepanel` - extension side panel UI
- `src/shared` - shared types, indicators, prompts, and selection logic

## License

MIT

