import { MySQLManager } from '../modules/mysql';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import * as os from 'os';
import { PassThrough } from 'stream';
import { createConnection } from 'mysql2/promise';

jest.mock('child_process');
jest.mock('mysql2/promise');

describe('MySQLManager restore with EPIPE handling', () => {
  let mysqlManager: MySQLManager;
  const mockConfig = {
    host: 'localhost',
    port: 3306,
    user: 'test',
    password: 'test',
    database: 'testdb'
  };

  beforeEach(() => {
    mysqlManager = new MySQLManager(mockConfig);
    jest.clearAllMocks();
    
    // Mock createConnection for all tests by default
    const mockConnection = {
      execute: jest.fn().mockResolvedValue([[{ SCHEMA_NAME: 'testdb' }]]),
      end: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue(undefined)
    };
    (createConnection as jest.Mock).mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should handle EPIPE error gracefully when mysql process terminates early', async () => {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `test-backup-${Date.now()}.sql.gz`);
    
    // Create a test backup file
    const testData = 'CREATE DATABASE IF NOT EXISTS testdb;\nUSE testdb;\nCREATE TABLE test (id INT);\n';
    const compressed = zlib.gzipSync(Buffer.from(testData));
    fs.writeFileSync(tempFile, compressed);

    try {
      // Create a mock stdin stream
      const mockStdin = new PassThrough();
      
      // Mock spawn to simulate mysql process that terminates early
      const mockMysqlProcess = {
        stdin: mockStdin,
        stderr: new PassThrough(),
        on: jest.fn(),
        kill: jest.fn()
      };

      // Setup event handlers
      mockMysqlProcess.on.mockImplementation((event, handler) => {
        if (event === 'close') {
          // Simulate successful close even though EPIPE might occur
          setTimeout(() => handler(0), 200);
        }
        return mockMysqlProcess;
      });

      // Simulate EPIPE error on stdin after a delay
      setTimeout(() => {
        const epipeError = new Error('write EPIPE') as Error & { code?: string };
        epipeError.code = 'EPIPE';
        mockStdin.emit('error', epipeError);
      }, 100);

      (spawn as jest.Mock).mockReturnValue(mockMysqlProcess);

      // This should not throw even with EPIPE error
      await expect(mysqlManager.restoreBackup(tempFile, 'testdb')).resolves.toBeUndefined();
      
      // Verify spawn was called with correct arguments (including large db optimizations)
      expect(spawn).toHaveBeenCalledWith('mysql', [
        '-h', 'localhost',
        '-P', '3306',
        '-u', 'test',
        '-ptest',
        '--max_allowed_packet=1G',
        '--net_buffer_length=16M',
        '--init-command=SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0; SET AUTOCOMMIT=0;',
        'testdb'
      ], { stdio: ['pipe', 'inherit', 'pipe'] });

    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it('should reject on non-EPIPE stdin errors', async () => {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `test-backup-${Date.now()}.sql.gz`);
    
    // Create a test backup file
    const testData = 'CREATE DATABASE IF NOT EXISTS testdb;';
    const compressed = zlib.gzipSync(Buffer.from(testData));
    fs.writeFileSync(tempFile, compressed);

    try {
      // Create a mock stdin stream
      const mockStdin = new PassThrough();
      
      // Mock spawn to simulate mysql process with non-EPIPE error
      const mockMysqlProcess = {
        stdin: mockStdin,
        stderr: new PassThrough(),
        on: jest.fn(),
        kill: jest.fn()
      };

      // Simulate non-EPIPE error on stdin
      setTimeout(() => {
        const error = new Error('Connection reset') as Error & { code?: string };
        error.code = 'ECONNRESET';
        mockStdin.emit('error', error);
      }, 50);

      (spawn as jest.Mock).mockReturnValue(mockMysqlProcess);

      // This should reject with non-EPIPE error
      await expect(mysqlManager.restoreBackup(tempFile, 'testdb'))
        .rejects.toThrow('MySQL stdin pipe error: Connection reset');

    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it('should reject when mysql process exits with non-zero code', async () => {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `test-backup-${Date.now()}.sql.gz`);
    
    // Create a test backup file
    const testData = 'CREATE DATABASE IF NOT EXISTS testdb;';
    const compressed = zlib.gzipSync(Buffer.from(testData));
    fs.writeFileSync(tempFile, compressed);

    try {
      // Create mock streams
      const mockStdin = new PassThrough();
      const mockStderr = new PassThrough();
      
      // Mock spawn to simulate mysql process that fails
      const mockMysqlProcess = {
        stdin: mockStdin,
        stderr: mockStderr,
        on: jest.fn(),
        kill: jest.fn()
      };

      mockMysqlProcess.on.mockImplementation((event, handler) => {
        if (event === 'close') {
          // Write error to stderr then close with error code
          mockStderr.write('ERROR 1045: Access denied');
          setTimeout(() => handler(1), 100);
        }
        return mockMysqlProcess;
      });

      (spawn as jest.Mock).mockReturnValue(mockMysqlProcess);

      // This should reject when mysql exits with code 1
      await expect(mysqlManager.restoreBackup(tempFile, 'testdb'))
        .rejects.toThrow('MySQL restore failed (exit code 1)');

    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it('should handle successful restore without errors', async () => {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `test-backup-${Date.now()}.sql.gz`);
    
    // Create a test backup file
    const testData = 'CREATE DATABASE IF NOT EXISTS testdb;\n';
    const compressed = zlib.gzipSync(Buffer.from(testData));
    fs.writeFileSync(tempFile, compressed);

    try {
      // Create a mock stdin stream
      const mockStdin = new PassThrough();
      
      // Mock spawn to simulate successful mysql process
      const mockMysqlProcess = {
        stdin: mockStdin,
        stderr: new PassThrough(),
        on: jest.fn(),
        kill: jest.fn()
      };

      mockMysqlProcess.on.mockImplementation((event, handler) => {
        if (event === 'close') {
          // Simulate successful close
          setTimeout(() => handler(0), 100);
        }
        return mockMysqlProcess;
      });

      (spawn as jest.Mock).mockReturnValue(mockMysqlProcess);

      // Mock progress callback
      const progressCallback = jest.fn();

      // This should complete successfully
      await expect(mysqlManager.restoreBackup(tempFile, 'testdb', progressCallback))
        .resolves.toBeUndefined();
      
      // Verify progress callback was called with completion
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          percentage: 100
        })
      );

    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  describe('Database creation during restore', () => {
    it('should create database if it does not exist before restore', async () => {
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `test-backup-${Date.now()}.sql.gz`);
      
      // Create a test backup file
      const testData = 'CREATE TABLE IF NOT EXISTS test (id INT);\nINSERT INTO test VALUES (1);\n';
      const compressed = zlib.gzipSync(Buffer.from(testData));
      fs.writeFileSync(tempFile, compressed);

      try {
        // Mock the database existence check to return false
        const mockConnection = {
          execute: jest.fn().mockResolvedValue([[]]),
          end: jest.fn().mockResolvedValue(undefined),
          ping: jest.fn().mockResolvedValue(undefined)
        };
        
        (createConnection as jest.Mock).mockResolvedValue(mockConnection);

        // Mock databaseExists to return false initially, then true after creation
        const databaseExistsMock = jest.spyOn(mysqlManager, 'databaseExists');
        databaseExistsMock.mockResolvedValueOnce(false);  // First check: doesn't exist
        databaseExistsMock.mockResolvedValueOnce(true);   // Second check: after creation, exists
        
        // Mock createDatabase to succeed
        jest.spyOn(mysqlManager, 'createDatabase').mockResolvedValue(undefined);

        // Create a mock stdin stream
        const mockStdin = new PassThrough();
        
        // Mock spawn to simulate successful mysql process
        const mockMysqlProcess = {
          stdin: mockStdin,
          stderr: new PassThrough(),
          on: jest.fn(),
          kill: jest.fn()
        };

        mockMysqlProcess.on.mockImplementation((event, handler) => {
          if (event === 'close') {
            setTimeout(() => handler(0), 100);
          }
          return mockMysqlProcess;
        });

        (spawn as jest.Mock).mockReturnValue(mockMysqlProcess);

        // This should create the database then restore successfully
        await expect(mysqlManager.restoreBackup(tempFile, 'newdb'))
          .resolves.toBeUndefined();
        
        // Verify database creation was attempted
        expect(mysqlManager.createDatabase).toHaveBeenCalledWith('newdb');
        
        // Verify the restore was attempted after database creation (with large db optimizations)
        expect(spawn).toHaveBeenCalledWith('mysql', [
          '-h', 'localhost',
          '-P', '3306',
          '-u', 'test',
          '-ptest',
          '--max_allowed_packet=1G',
          '--net_buffer_length=16M',
          '--init-command=SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0; SET AUTOCOMMIT=0;',
          'newdb'
        ], { stdio: ['pipe', 'inherit', 'pipe'] });

      } finally {
        // Clean up temp file
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        jest.restoreAllMocks();
      }
    });

    it('should not create database if it already exists', async () => {
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `test-backup-${Date.now()}.sql.gz`);
      
      // Create a test backup file
      const testData = 'CREATE TABLE IF NOT EXISTS test (id INT);\n';
      const compressed = zlib.gzipSync(Buffer.from(testData));
      fs.writeFileSync(tempFile, compressed);

      try {
        // Mock the database existence check to return true
        const mockConnection = {
          execute: jest.fn().mockResolvedValue([[{ SCHEMA_NAME: 'existingdb' }]]),
          end: jest.fn().mockResolvedValue(undefined),
          ping: jest.fn().mockResolvedValue(undefined)
        };
        
        (createConnection as jest.Mock).mockResolvedValue(mockConnection);

        // Mock databaseExists to return true
        jest.spyOn(mysqlManager, 'databaseExists').mockResolvedValue(true);
        
        // Mock createDatabase - should not be called
        jest.spyOn(mysqlManager, 'createDatabase').mockResolvedValue(undefined);

        // Create a mock stdin stream
        const mockStdin = new PassThrough();
        
        // Mock spawn to simulate successful mysql process
        const mockMysqlProcess = {
          stdin: mockStdin,
          stderr: new PassThrough(),
          on: jest.fn(),
          kill: jest.fn()
        };

        mockMysqlProcess.on.mockImplementation((event, handler) => {
          if (event === 'close') {
            setTimeout(() => handler(0), 100);
          }
          return mockMysqlProcess;
        });

        (spawn as jest.Mock).mockReturnValue(mockMysqlProcess);

        // This should restore without creating database
        await expect(mysqlManager.restoreBackup(tempFile, 'existingdb'))
          .resolves.toBeUndefined();
        
        // Verify database creation was NOT attempted
        expect(mysqlManager.createDatabase).not.toHaveBeenCalled();

      } finally {
        // Clean up temp file
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        jest.restoreAllMocks();
      }
    });
  });
});