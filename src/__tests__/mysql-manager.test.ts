import { MySQLManager } from '../modules/mysql';

// Mock mysql2/promise
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn()
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

// Mock zlib
jest.mock('zlib', () => ({
  createGzip: jest.fn()
}));

// Mock fs
jest.mock('fs', () => ({
  createWriteStream: jest.fn(),
  createReadStream: jest.fn()
}));

describe('MySQLManager', () => {
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

  describe('testConnection', () => {
    it('should test connection successfully', async () => {
      const mockConnection = {
        ping: jest.fn().mockResolvedValue(undefined),
        end: jest.fn().mockResolvedValue(undefined)
      };

      const { createConnection } = require('mysql2/promise');
      createConnection.mockResolvedValue(mockConnection);

      await expect(mysqlManager.testConnection()).resolves.toBeUndefined();
      
      expect(createConnection).toHaveBeenCalledWith({
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password',
        database: 'testdb'
      });
      expect(mockConnection.ping).toHaveBeenCalled();
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should handle connection failure', async () => {
      const { createConnection } = require('mysql2/promise');
      createConnection.mockRejectedValue(new Error('Connection failed'));

      await expect(mysqlManager.testConnection()).rejects.toThrow('Connection failed');
    });
  });

  describe('listDatabases', () => {
    it('should list databases excluding system databases', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[
          { Database: 'testdb1' },
          { Database: 'testdb2' },
          { Database: 'information_schema' },
          { Database: 'mysql' },
          { Database: 'performance_schema' },
          { Database: 'sys' }
        ]]),
        end: jest.fn().mockResolvedValue(undefined)
      };

      const { createConnection } = require('mysql2/promise');
      createConnection.mockResolvedValue(mockConnection);

      const databases = await mysqlManager.listDatabases();

      expect(databases).toEqual(['testdb1', 'testdb2']);
      expect(mockConnection.execute).toHaveBeenCalledWith('SHOW DATABASES');
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should handle database listing error', async () => {
      const mockConnection = {
        execute: jest.fn().mockRejectedValue(new Error('Query failed')),
        end: jest.fn().mockResolvedValue(undefined)
      };

      const { createConnection } = require('mysql2/promise');
      createConnection.mockResolvedValue(mockConnection);

      await expect(mysqlManager.listDatabases()).rejects.toThrow('Query failed');
      expect(mockConnection.end).toHaveBeenCalled();
    });
  });

  describe('createBackup', () => {
    it('should setup backup command correctly', () => {
      const mockProcess = {
        stdout: {
          pipe: jest.fn().mockReturnThis(),
          on: jest.fn()
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn()
      };

      const mockGzip = {
        pipe: jest.fn().mockReturnThis(),
        on: jest.fn()
      };

      const mockWriteStream = {
        on: jest.fn()
      };

      const { spawn } = require('child_process');
      const zlib = require('zlib');
      const fs = require('fs');

      spawn.mockReturnValue(mockProcess);
      zlib.createGzip.mockReturnValue(mockGzip);
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      // Call createBackup but don't wait for completion
      mysqlManager.createBackup('/tmp/backup.sql.gz');

      expect(spawn).toHaveBeenCalledWith('mysqldump', [
        '-h', 'localhost',
        '-P', '3306',
        '-u', 'root',
        '-ppassword',
        '--compress',
        '--verbose',
        '--lock-tables=false',
        'testdb'
      ]);
      expect(zlib.createGzip).toHaveBeenCalled();
      expect(fs.createWriteStream).toHaveBeenCalledWith('/tmp/backup.sql.gz');
    });

    it('should handle errors in backup', () => {
      const mockProcess = {
        stdout: {
          pipe: jest.fn().mockReturnThis(),
          on: jest.fn()
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn()
      };

      const { spawn } = require('child_process');
      spawn.mockReturnValue(mockProcess);

      // Just verify the method can be called
      expect(() => {
        mysqlManager.createBackup('/tmp/backup.sql.gz');
      }).not.toThrow();
    });
  });

  describe('databaseExists', () => {
    it('should return true if database exists', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[{ SCHEMA_NAME: 'testdb' }]]),
        end: jest.fn().mockResolvedValue(undefined)
      };

      const { createConnection } = require('mysql2/promise');
      createConnection.mockResolvedValue(mockConnection);

      const exists = await mysqlManager.databaseExists('testdb');

      expect(exists).toBe(true);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        ['testdb']
      );
    });

    it('should return false if database does not exist', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[]]), // Empty array
        end: jest.fn().mockResolvedValue(undefined)
      };

      const { createConnection } = require('mysql2/promise');
      createConnection.mockResolvedValue(mockConnection);

      const exists = await mysqlManager.databaseExists('nonexistent');

      expect(exists).toBe(false);
    });
  });
});