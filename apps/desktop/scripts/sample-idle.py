import argparse
import json
import math
import subprocess
import time
from pathlib import Path


def cpu_seconds(value):
    days, separator, rest = value.partition('-')
    if not separator:
        rest, days = days, '0'
    seconds = 0.0
    for part in rest.split(':'):
        seconds = seconds * 60 + float(part)
    return int(days) * 86400 + seconds


def snapshot(main_pid, detached_executables):
    output = subprocess.check_output(
        ['ps', '-axo', 'pid=,ppid=,rss=,time=,stat=,lstart=,args='], text=True,
    )
    rows = []
    selected = {main_pid}
    for line in output.splitlines():
        fields = line.strip().split(None, 10)
        if len(fields) != 11:
            continue
        pid, parent, rss, cpu, state = fields[:5]
        started_at = " ".join(fields[5:10])
        command = fields[10]
        if "Z" in state or (int(rss) == 0 and cpu_seconds(cpu) == 0):
            continue
        row = dict(pid=int(pid), startedAt=started_at, parent=int(parent), rssMiB=int(rss)/1024,
                   cpuSeconds=cpu_seconds(cpu), command=command)
        rows.append(row)
        if any(command.startswith(executable + ' ') for executable in detached_executables):
            if any(name in command for name in ['/host-service.js', '/pty-daemon.js', '/terminal-host.js']):
                selected.add(int(pid))
    while True:
        descendants = {row['pid'] for row in rows if row['parent'] in selected}
        if descendants <= selected:
            break
        selected |= descendants
    result = []
    for row in rows:
        if row['pid'] not in selected:
            continue
        command = row.pop('command')
        role = 'other-child'
        if row['pid'] == main_pid:
            role = 'main'
        elif '/pty-daemon.js' in command:
            role = 'pty-daemon'
        elif '/host-service.js' in command:
            role = 'host-service'
        elif '/terminal-host.js' in command:
            role = 'terminal-host'
        elif '--type=renderer' in command:
            role = 'renderer'
        elif '--type=gpu-process' in command:
            role = 'gpu'
        elif '--type=utility' in command:
            role = 'utility'
        row['role'] = role
        result.append(row)
    return result


def sample(args):
    started = time.monotonic()
    samples = []
    while True:
        captured = time.monotonic()
        rows = snapshot(args.pid, args.detached_executable)
        if not any(row['pid'] == args.pid for row in rows):
            raise RuntimeError('Main app exited during R0')
        main = next(row for row in rows if row['pid'] == args.pid)
        if samples:
            original_main = next(row for row in samples[0]['processes'] if row['pid'] == args.pid)
            if main['startedAt'] != original_main['startedAt']:
                raise RuntimeError('Main PID was reused during R0')
        samples.append(dict(elapsedSeconds=captured-started, processes=rows))
        if captured - started >= args.seconds:
            break
        time.sleep(max(0, 1-(time.monotonic()-captured)))
    args.output.write_text(json.dumps(dict(samples=samples), indent=2)+'\n')
    by_instance = {}
    for observation in samples:
        for row in observation['processes']:
            by_instance.setdefault((row['pid'], row['startedAt']), []).append((observation['elapsedSeconds'], row))
    summary = []
    for (pid, started_at), observations in by_instance.items():
        first, last = observations[0], observations[-1]
        duration = last[0] - first[0]
        if any(current[1]['cpuSeconds'] < previous[1]['cpuSeconds']
               for previous, current in zip(observations, observations[1:])):
            raise RuntimeError(f'CPU counter reset for PID {pid}; sample is invalid')
        rss = sorted(row['rssMiB'] for _, row in observations)
        summary.append(dict(
            pid=pid, startedAt=started_at, role=first[1]['role'], observations=len(observations),
            observedSeconds=duration,
            rssP50MiB=rss[math.ceil(len(rss)*.5)-1],
            rssP95MiB=rss[math.ceil(len(rss)*.95)-1],
            cpuPercent=100*(last[1]['cpuSeconds']-first[1]['cpuSeconds'])/duration if duration else None,
        ))
    args.output.write_text(json.dumps(dict(durationSeconds=samples[-1]['elapsedSeconds'],
                                          summary=summary, samples=samples), indent=2)+'\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Sample process RSS and cumulative CPU for R0 on macOS.')
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--seconds', type=float, default=300)
    parser.add_argument('--detached-executable', action='append', default=[])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.seconds < 300:
        parser.error('R0 requires at least 300 seconds')
    sample(args)
