import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sample_idle', Path(__file__).with_name('sample-idle.py'))
sampler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sampler)


class IdleSamplerTests(unittest.TestCase):
    def test_zombie_is_not_a_live_main(self):
        row = '1 0 0 00:00.00 Z Mon Sep 28 17:00:00 2026 <defunct>\n'
        with patch.object(sampler.subprocess, 'check_output', return_value=row):
            self.assertEqual(sampler.snapshot(1, []), [])

    def test_zeroed_exiting_process_is_not_a_cpu_counter_reset(self):
        rows = ('1 0 1024 00:01.00 S Mon Sep 28 17:00:00 2026 /app\n'
                '2 1 0 00:00.00 E Mon Sep 28 17:00:01 2026 /child\n')
        with patch.object(sampler.subprocess, 'check_output', return_value=rows):
            self.assertEqual([row['pid'] for row in sampler.snapshot(1, [])], [1])

    def test_reused_child_pid_has_separate_cpu_counters(self):
        first = ('1 0 1024 00:01.00 S Mon Sep 28 17:00:00 2026 /app\n'
                 '2 1 512 00:10.00 S Mon Sep 28 17:00:01 2026 /child\n')
        last = ('1 0 1024 00:02.00 S Mon Sep 28 17:00:00 2026 /app\n'
                '2 1 512 00:01.00 S Mon Sep 28 17:04:01 2026 /child\n')
        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(pid=1, seconds=300, detached_executable=[],
                                   output=Path(directory)/'result.json')
            with (patch.object(sampler.subprocess, 'check_output', side_effect=[first, last]),
                  patch.object(sampler.time, 'monotonic', side_effect=[0, 0, 0, 300]),
                  patch.object(sampler.time, 'sleep'), patch('builtins.print')):
                sampler.sample(args)
            import json
            result = json.loads(args.output.read_text())
            self.assertEqual(len(result['summary']), 3)
            self.assertAlmostEqual(result['summary'][0]['cpuPercent'], 1/3)
            self.assertIsNone(result['summary'][1]['cpuPercent'])
            self.assertIsNone(result['summary'][2]['cpuPercent'])


if __name__ == '__main__':
    unittest.main()
