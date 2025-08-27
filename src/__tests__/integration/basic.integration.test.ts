import { describe, it, expect } from '@jest/globals';
import { spawn } from 'child_process';
import * as path from 'path';

describe('MySQL S3 Backup Integration Tests', () => {
  it('should show CLI help', async () => {
    const result = await runCommand(['--help']);
    expect(result.stdout).toContain('mysqldump-s3');
    expect(result.code).toBe(0);
  });

  it('should show backup command help', async () => {
    const result = await runCommand(['backup', '--help']);
    expect(result.stdout).toContain('backup');
    expect(result.code).toBe(0);
  });

  it('should show list command help', async () => {
    const result = await runCommand(['list', '--help']);
    expect(result.stdout).toContain('list');
    expect(result.code).toBe(0);
  });

  it('should show restore command help', async () => {
    const result = await runCommand(['restore', '--help']);
    expect(result.stdout).toContain('restore');
    expect(result.code).toBe(0);
  });

  it('should show version', async () => {
    const result = await runCommand(['--version']);
    expect(result.stdout).toContain('1.0.0');
    expect(result.code).toBe(0);
  });
});

function runCommand(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const cliPath = path.join(__dirname, '../../cli.js');
    const proc = spawn('node', [cliPath, ...args]);
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
    
    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, code: -1 });
    });
  });
}