// Background export: the job script, ffmpeg arguments per format and progress read from the logs.
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FORMAT_PLANS, jobScript, readJob, type JobInfo } from '../../src/tools/export.js';

function job(over: Partial<JobInfo> = {}): JobInfo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-mcp-export-'));
  return { id: 'j1', format: 'gif', comp: "Bob's comp", project: '/p/Film.aep', output: '/out/x.gif', intermediate: path.join(dir, 'render.mov'), frames: 100, startFrame: 0, endFrame: 99, fps: 25, startedAt: new Date().toISOString(), dir, ...over };
}

describe('export jobs', () => {
  it('writes a script that renders at low priority, converts and marks each phase', () => {
    const j = job();
    const args = FORMAT_PLANS.gif.ffmpeg!({ scale: 1, fps: 15, width: 960, out: j.output, progress: path.join(j.dir, 'ffmpeg.progress') });
    const s = jobScript(j, '/AE/aerender', '/bin/ffmpeg', args);
    expect(s).toContain("nice -n 15 '/AE/aerender' -project '/p/Film.aep' -comp 'Bob'\\''s comp'");
    expect(s).toContain("-OMtemplate 'High Quality'");
    expect(s).toContain('-s 0 -e 99');
    expect(s).toMatch(/echo rendering .*\n.*\necho converting .*\n.*ffmpeg.*palettegen.*\nrm -f .*render\.mov.*\necho done/);
    fs.rmSync(j.dir, { recursive: true, force: true });
  });

  it('renders mp4 and ProRes directly with no conversion', () => {
    const j = job({ format: 'mp4', intermediate: null, output: '/out/x.mp4' });
    const s = jobScript(j, '/AE/aerender', null, null);
    expect(s).toContain("-OMtemplate 'H.264 - Match Render Settings - 40 Mbps' -output '/out/x.mp4'");
    expect(s).not.toContain('converting');
    expect(FORMAT_PLANS['prores-4444'].template).toBe('High Quality with Alpha');
    fs.rmSync(j.dir, { recursive: true, force: true });
  });

  it('reads progress from the aerender log and ffmpeg progress, and errors of a failed job', () => {
    const j = job();
    fs.writeFileSync(path.join(j.dir, 'job.json'), JSON.stringify(j));
    fs.writeFileSync(path.join(j.dir, 'status'), 'rendering\n');
    fs.writeFileSync(path.join(j.dir, 'render.log'), 'PROGRESS:  0:00:00:10 (11): 0 Seconds\nPROGRESS:  0:00:01:24 (50): 1 Seconds\n');
    expect(readJob(j.dir)).toMatchObject({ status: 'rendering', percent: 50 });
    fs.writeFileSync(path.join(j.dir, 'status'), 'converting\n');
    fs.writeFileSync(path.join(j.dir, 'ffmpeg.progress'), 'out_time_ms=1000000\nout_time_ms=3000000\n');
    expect(readJob(j.dir)).toMatchObject({ status: 'converting', percent: 75 });
    fs.writeFileSync(path.join(j.dir, 'status'), 'failed\n');
    fs.appendFileSync(path.join(j.dir, 'render.log'), 'aerender ERROR: No comp was found with the given name.\n');
    expect((readJob(j.dir) as any).errors[0]).toMatch(/No comp was found/);
    fs.rmSync(j.dir, { recursive: true, force: true });
  });
});
