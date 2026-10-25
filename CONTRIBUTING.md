# Contributing

Thanks for helping! Bug reports, ideas and pull requests are welcome, in English
or German.

## Reporting a problem

Open an issue with the bug report form. Include the versions asked for there and,
if you can, the diagnostics of the integration (**Settings → Devices & services →
FRITZ!Box Network → ⋮ → Download diagnostics**). MAC and IP addresses and names
are removed from it; still look through the file before you share it.

## Local development

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/ruff check custom_components tests tools
.venv/bin/ruff format --check custom_components tests tools
.venv/bin/pytest
```

Home Assistant 2026.8 and newer need Python 3.14. The tests run against a fake
client fed with anonymised captures in `tests/fixtures/`; no FRITZ!Box is needed.

## Real FRITZ!Box data

`tools/spike.py` reads a real box without changing anything and is how the
field names of the host list and the mesh data were checked. It takes the
credentials from `FRITZ_HOST`, `FRITZ_USER`, `FRITZ_PASSWORD` (and optionally
`FRITZ_TLS=1`) and writes to `spike_out/`, which is not part of the repository.
If you add a fixture from your own box, anonymise it first: the script writes an
anonymised copy next to the raw files, but look through it before you commit.
A fixture must not contain real MAC or IP addresses, names or SSIDs.

## Pull requests

- Keep a change small and focused, with a test for the behaviour it adds or fixes.
- `ruff check`, `ruff format --check` and `pytest` must pass; the same checks run
  in GitHub Actions.
- Entity ids and unique ids are part of what users rely on: do not change how
  they are built without a migration.
- User-facing changes get a line in `CHANGELOG.md` (German) and
  `CHANGELOG.en.md` (English), grouped under New, Changed or Fixed.

## Continuous integration

Three GitHub Actions run on every push and pull request:

- `.github/workflows/tests.yml`: ruff and the tests.
- `.github/workflows/hassfest.yml`: validates the integration against Home
  Assistant's own requirements (manifest, translations, and so on).
- `.github/workflows/hacs.yml`: validates the repository against the requirements
  for a HACS integration.

A push to `main` that changes the version in `manifest.json` creates the matching
tag and a release (`tag.yml`, `release.yml`). The release notes are taken from the
`## <version>` section of `CHANGELOG.md`.
