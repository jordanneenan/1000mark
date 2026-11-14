# Contributing to 1000Mark

Ideas, bug reports and code are welcome.

## Ideas and bugs

Open an issue. For a bug, say what device, system and browser you used (or that it was the computer test), what you did, and what happened. Please leave out personal details: the site's results never need your email or device names.

## Code

1. Fork the repository and make your change on a branch.
2. Open a pull request that explains what it changes and why.
3. The CLA check will ask you to agree to the Contributor Licence Agreement ([CLA.md](CLA.md)) by posting a comment. You only do this once.
4. Jordan reviews every pull request. Changes may be asked for, and not every pull request will be merged.

The code is source-available, not open source. You may change it only to propose those changes here; you may not run, host or share your own copy of 1000Mark. See [LICENSE](LICENSE).

## Running it while you work on it

- The site on its own: `./serve.py`, then open http://127.0.0.1:4173. Results stay in that browser.
- With accounts: `PORT=4273 HOST=127.0.0.1 DATA_DIR=/some/scratch/folder node server/server.mjs` (Node 22.13 or newer), then open http://localhost:4273.
- The computer test: `cd native && cargo build --release`, then `target/release/pressmark --local`. `--local` keeps the results on your computer instead of sending them to the site.

## Things to know

- Scores must stay comparable for years. A test's reference value is never changed. A test that measures something new gets a new id.
- The site has no build step and no dependencies. Keep it that way.
- Results data and accounts are not in this repository and are never shared.
