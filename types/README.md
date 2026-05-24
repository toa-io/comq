# Type declarations

- **`source/types.js`** — JSDoc definitions for the global `comq.*` namespace used inside this repository.
- **`index.d.ts`** — public TypeScript API (`import { connect, IO } from 'comq'`).

When you change the public API, update both files so editor hints and published types stay aligned.

Run `npm run typecheck` to verify JSDoc against `source/`.
