# highground

Personal project notes, references, and tactical notes with a Dota-inspired theme.

This repository is for personal use only.

## Hero data sync

The project stores hero metadata in `data/heroes.json`, which mirrors the structure Valve exposes for Dota hero definitions.

If Valve updates hero attributes, adds new heroes, or changes names/roles, refresh the local data from a public source instead of hand-editing the file.

Recommended sources:

- OpenDota hero metadata: https://api.opendota.com/api/heroes
- Community static snapshot: https://raw.githubusercontent.com/odota/dotaconstants/master/build/heroes.json

Use the OpenDota API for the current live metadata, or the dotaconstants snapshot for a stable JSON file that is easier to diff and store in version control.

### Reminder for future updates

When Valve ships a new hero or patches existing hero stats/roles, run a sync and compare the result with the local data before the app is used again.

Quick sync command:

```powershell
py .\sync_heroes.py
```

Dry run first if you want to review the changes without writing files:

```powershell
py .\sync_heroes.py --dry-run
```

If `py` is not available in your PowerShell environment, use `python` instead:

```powershell
python .\sync_heroes.py --dry-run
```

Checklist:

- Pull the latest hero list from OpenDota or dotaconstants
- Compare by hero `id` or `name`
- Update `localized_name`, `primary_attr`, `attack_type`, and `roles` if changed
- Add any newly introduced heroes to `data/heroes.json`
- Commit the refreshed data set with the patch notes

This keeps the project aligned with Valve's live hero data without needing to manually maintain the entire list by hand.
