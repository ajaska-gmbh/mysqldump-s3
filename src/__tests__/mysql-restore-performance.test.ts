import { MySQLManager } from '../modules/mysql';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

// Mock zlib
jest.mock('zlib', () => ({
  createGunzip: jest.fn()
}));

// Mock fs
jest.mock('fs', () => ({
  createReadStream: jest.fn(),
  existsSync: jest.fn(),
  statSync: jest.fn()
}));

describe('MySQLManager Restore Performance', () => {
  let mysqlManager: MySQLManager;
  const mockConfig = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'password',
    database: 'testdb'
  };

  beforeEach(() => {
    mysqlManager = new MySQLManager(mockConfig);
    jest.clearAllMocks();
  });

  describe('restoreBackup command optimization', () => {
    it('should use optimized MySQL command parameters for file-based restore', () => {
      const mockMysqlProcess = {
        stdin: {
          on: jest.fn(),
          writableHighWaterMark: 1024,
          writableLength: 0
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn()
      };

      const mockGunzip = {
        on: jest.fn()
      };

      const mockReadStream = {
        on: jest.fn(),
        pipe: jest.fn().mockReturnThis(),
        resume: jest.fn(),
        pause: jest.fn()
      };

      const { spawn } = require('child_process');
      const zlib = require('zlib');
      const fs = require('fs');

      spawn.mockReturnValue(mockMysqlProcess);
      zlib.createGunzip.mockReturnValue(mockGunzip);
      fs.createReadStream.mockReturnValue(mockReadStream);
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: 1024 });

      // Call restoreBackup
      mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'testdb');

      // Verify that MySQL command includes performance optimizations
      expect(spawn).toHaveBeenCalledWith('mysql', expect.arrayContaining([
        '-h', 'localhost',
        '-P', '3306',
        '-u', 'root',
        '-ppassword',
        '--compress',
        '--lock-tables=false',
        '-e', 'SET foreign_key_checks = 0; SET unique_checks = 0; SET autocommit = 0;',
        'testdb'
      ]));
    });
  });

  describe('restoreBackupFromStream command optimization', () => {
    it('should use optimized MySQL command parameters for streaming restore', () => {
      const mockMysqlProcess = {
        stdin: {
          on: jest.fn(),
          writableHighWaterMark: 1024,
          writableLength: 0
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn(),
        killed: false,
        kill: jest.fn()
      };

      const mockGunzip = {
        on: jest.fn(),
        destroy: jest.fn()
      };

      const mockInputStream = {
        on: jest.fn(),
        pipe: jest.fn().mockReturnThis(),
        resume: jest.fn(),
        pause: jest.fn(),
        destroy: jest.fn()
      } as any;

      const { spawn } = require('child_process');
      const zlib = require('zlib');

      spawn.mockReturnValue(mockMysqlProcess);
      zlib.createGunzip.mockReturnValue(mockGunzip);

      // Call restoreBackupFromStream
      mysqlManager.restoreBackupFromStream(mockInputStream, 1000, 'testdb');

      // Verify that MySQL command includes performance optimizations
      expect(spawn).toHaveBeenCalledWith('mysql', expect.arrayContaining([
        '-h', 'localhost',
        '-P', '3306', 
        '-u', 'root',
        '-ppassword',
        '--compress',
        '--lock-tables=false',
        '-e', 'SET foreign_key_checks = 0; SET unique_checks = 0; SET autocommit = 0;',
        'testdb'
      ]));
    });
  });
});