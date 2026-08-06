import subprocess
import os
repo = os.path.dirname(__file__)
steps = [
    ['git', 'status', '--short'],
    ['git', 'add', '.'],
    ['git', 'commit', '-m', 'Organize image assets and update favicon paths'],
    ['git', 'push'],
    ['git', 'log', '-1', '--oneline'],
]
for cmd in steps:
    print('>>>', ' '.join(cmd))
    p = subprocess.run(cmd, cwd=repo, capture_output=True, text=True)
    if p.stdout:
        print(p.stdout.strip())
    if p.stderr:
        print(p.stderr.strip())
    if p.returncode != 0:
        raise SystemExit(f'Command failed: {cmd}')
print('Done')
