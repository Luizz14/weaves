import argparse
import json
import math
from pathlib import Path

MARKERS = (
    'process-start',
    'bootstrap-imports-end',
    'shell-env-ready',
    'app-ready',
    'i18n-ready',
    'app-state-ready',
    'webview-extension-ready',
    'v1-terminal-reconciled',
    'bridge-ready',
    'host-reconcile-start',
    'active-host-spawned',
    'host-process-start',
    'host-imports-end',
    'host-db-ready',
    'host-app-created',
    'host-listening',
    'host-terminal-env-ready',
    'host-daemon-ready',
    'active-host-healthy',
    'host-start-cancelled',
    'agent-setup-end',
    'window-created',
    'ready-to-show',
    'window-show',
    'did-finish-load',
    'react-commit',
    'router-ready',
    'query-cache-restored',
    'renderer-i18n-ready',
    'auth-hydrated',
    'session-resolved',
    'org-resolved',
    'collections-ready',
    'host-url-ready',
    'shell-interactive',
    'terminal-ws-open',
    'host-first-attach-start',
    'host-first-attach-ready',
    'terminal-attached',
    'terminal-first-bytes',
    'terminal-usable',
)


def percentile(values, fraction):
    return sorted(values)[math.ceil(len(values) * fraction) - 1]


def summarize(paths):
    samples = {marker: [] for marker in MARKERS}
    for path in paths:
        launch = {}
        for line in path.read_text().splitlines():
            record = json.loads(line)
            marker = record['marker']
            value = record['durationMs']
            if marker not in samples or marker in launch:
                raise ValueError(f'{path}: unknown or duplicate marker')
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f'{path}: invalid duration')
            launch[marker] = value
        for marker, value in launch.items():
            samples[marker].append(value)
    return {
        marker: {
            'observed': len(values),
            'missing': len(paths) - len(values),
            'p50Ms': percentile(values, .5) if values else None,
            'p75Ms': percentile(values, .75) if values else None,
            'p95Ms': percentile(values, .95) if values else None,
            'samplesMs': values,
        } for marker, values in samples.items()
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Summarize one startup JSONL file per launch.')
    parser.add_argument('logs', type=Path, nargs='+')
    args = parser.parse_args()
    print(json.dumps(summarize(args.logs), indent=2))
