/**
 * Integration tests for the CLI commands
 * These tests can be run against real MySQL and S3 services when available
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Helper function to run CLI commands
function runCommand(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const cliPath = path.join(__dirname, '../../dist/cli.js');
    const proc = spawn('node', [cliPath, ...args], {
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code || 0 });
    });
  });
}

describe('CLI Integration Tests', () => {
  // Simple test to verify the command files can be imported
  it('should import all command modules successfully', () => {
    expect(() => require('../commands/backup')).not.toThrow();
    expect(() => require('../commands/list')).not.toThrow();
    expect(() => require('../commands/restore')).not.toThrow();
  });

  it('should have all expected exports', () => {
    const backup = require('../commands/backup');
    const list = require('../commands/list');
    const restore = require('../commands/restore');

    expect(typeof backup.backupCommand).toBe('function');
    expect(typeof list.listCommand).toBe('function');
    expect(typeof restore.restoreCommand).toBe('function');
  });

  // Only run these tests if we're in CI environment with real services
  if (process.env.CI && process.env.NODE_ENV === 'test') {
    describe('End-to-End Integration Tests', () => {
      let backupKey: string;

      beforeAll(async () => {
        // Ensure the CLI is built
        const distExists = fs.existsSync(path.join(__dirname, '../../dist/cli.js'));
        if (!distExists) {
          throw new Error('Please run "npm run build" before running integration tests');
        }
      });

      it('should successfully create a backup', async () => {
        const result = await runCommand(['backup', '-v']);
        
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Backup completed successfully');
        expect(result.stdout).toContain('Uploading to S3');
        
        // Extract backup key from output
        const keyMatch = result.stdout.match(/Key: ([\w-]+\.sql\.gz)/);
        expect(keyMatch).toBeTruthy();
        backupKey = keyMatch![1];
      }, 60000); // 60 second timeout for backup operation

      it('should list backups including the one just created', async () => {
        const result = await runCommand(['list', '-f', 'json']);
        
        expect(result.code).toBe(0);
        
        const backups = JSON.parse(result.stdout);
        expect(Array.isArray(backups)).toBe(true);
        expect(backups.length).toBeGreaterThan(0);
        
        const latestBackup = backups.find((b: any) => b.key === backupKey);
        expect(latestBackup).toBeDefined();
        expect(latestBackup.size).toBeGreaterThan(0);
      }, 30000);

      it('should successfully restore from backup', async () => {
        const result = await runCommand([
          'restore',
          '--backup', backupKey,
          '--database', 'testdb',
          '--non-interactive',
          '--force',
          '-v'
        ]);
        
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Restore completed successfully');
        expect(result.stdout).toContain('Downloading backup from S3');
        expect(result.stdout).toContain('Restoring to database');
      }, 60000); // 60 second timeout for restore operation

      it('should handle errors gracefully', async () => {
        // Test with invalid backup key
        const result = await runCommand([
          'restore',
          '--backup', 'non-existent-backup.sql.gz',
          '--database', 'testdb',
          '--non-interactive',
          '--force'
        ]);
        
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('Error');
      }, 30000);
    });
  }
});