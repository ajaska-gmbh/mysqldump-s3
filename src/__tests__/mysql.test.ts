import { MySQLManager } from '../modules/mysql';

// Mock mysql2/promise
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn()
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

// Mock fs
jest.mock('fs', () => ({
  createReadStream: jest.fn(),
  createWriteStream: jest.fn(),
  existsSync: jest.fn(),
  statSync: jest.fn()
}));

// Mock zlib
jest.mock('zlib', () => ({
  createGzip: jest.fn(),
  createGunzip: jest.fn()
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
    it('should test database connection successfully', async () => {
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

    it('should throw error if connection fails', async () => {
      const { createConnection } = require('mysql2/promise');
      createConnection.mockRejectedValue(new Error('Connection failed'));

      await expect(mysqlManager.testConnection()).rejects.toThrow('Connection failed');
    });
  });

  describe('listDatabases', () => {
    it('should list user databases', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[
          { Database: 'information_schema' },
          { Database: 'mysql' },
          { Database: 'performance_schema' },
          { Database: 'sys' },
          { Database: 'myapp' },
          { Database: 'testdb' }
        ]]),
        end: jest.fn().mockResolvedValue(undefined)
      };

      const { createConnection } = require('mysql2/promise');
      createConnection.mockResolvedValue(mockConnection);

      const databases = await mysqlManager.listDatabases();
      
      expect(databases).toEqual(['myapp', 'testdb']);
      expect(mockConnection.execute).toHaveBeenCalledWith('SHOW DATABASES');
      expect(mockConnection.end).toHaveBeenCalled();
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
        execute: jest.fn().mockResolvedValue([[]]),
        end: jest.fn().mockResolvedValue(undefined)
      };

      const { createConnection } = require('mysql2/promise');
      createConnection.mockResolvedValue(mockConnection);

      const exists = await mysqlManager.databaseExists('nonexistent');
      
      expect(exists).toBe(false);
    });
  });
});