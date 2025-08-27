import { ConfigManager } from '../modules/config';
import { MySQLManager } from '../modules/mysql';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { spawn } from 'child_process';

jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  createWriteStream: jest.fn(),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn()
}));

jest.mock('zlib', () => ({
  createGzip: jest.fn(() => ({
    on: jest.fn(),
    pipe: jest.fn()
  }))
}));

describe('Schema-specific backup functionality', () => {
  let configManager: ConfigManager;
  let mysqlManager: MySQLManager;

  beforeEach(() => {
    jest.clearAllMocks();
    configManager = ConfigManager.getInstance();
    configManager.reset();
  });

  describe('ConfigManager schema handling', () => {
    it('should parse schemas from environment variable', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'root';
      process.env.DB_PASSWORD = 'password';
      process.env.DB_SCHEMAS = 'schema1, schema2, schema3';
      process.env.AWS_ACCESS_KEY_ID = 'key';
      process.env.AWS_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const config = configManager.loadConfig();
      
      expect(config.database.schemas).toEqual(['schema1', 'schema2', 'schema3']);
    });

    it('should generate S3 key with schema names', () => {
      const key = configManager.generateS3Key(undefined, ['schema1', 'schema2']);
      expect(key).toMatch(/^schema1-schema2-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql\.gz$/);
    });

    it('should prefer schemas over database in S3 key generation', () => {
      const key = configManager.generateS3Key('mydb', ['schema1', 'schema2']);
      expect(key).toMatch(/^schema1-schema2-/);
      expect(key).not.toMatch(/mydb/);
    });

    it('should use database name if no schemas provided', () => {
      const key = configManager.generateS3Key('mydb');
      expect(key).toMatch(/^mydb-/);
    });

    it('should use "all" if neither schemas nor database provided', () => {
      const key = configManager.generateS3Key();
      expect(key).toMatch(/^all-/);
    });
  });

  describe('MySQLManager schema backup', () => {
    it('should use --databases flag when schemas are specified', async () => {
      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 20);
          }
        })
      };
      
      const mockGzip = {
        on: jest.fn(),
        pipe: jest.fn().mockReturnValue(mockOutput)
      };
      
      (zlib.createGzip as jest.Mock).mockReturnValue(mockGzip);
      
      const mockStdout = { 
        pipe: jest.fn().mockReturnValue(mockGzip) 
      };
      
      const mockStderr = { on: jest.fn() };
      const mockProcess = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        })
      };

      (spawn as jest.Mock).mockReturnValue(mockProcess);
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockOutput);

      mysqlManager = new MySQLManager({
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password',
        schemas: ['schema1', 'schema2', 'schema3']
      });

      await mysqlManager.createBackup('/tmp/backup.sql.gz');

      expect(spawn).toHaveBeenCalledWith('mysqldump', expect.arrayContaining([
        '--databases',
        'schema1',
        'schema2',
        'schema3'
      ]));
    });

    it('should use single database when no schemas but database is specified', async () => {
      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 20);
          }
        })
      };
      
      const mockGzip = {
        on: jest.fn(),
        pipe: jest.fn().mockReturnValue(mockOutput)
      };
      
      (zlib.createGzip as jest.Mock).mockReturnValue(mockGzip);
      
      const mockStdout = { 
        pipe: jest.fn().mockReturnValue(mockGzip) 
      };
      
      const mockStderr = { on: jest.fn() };
      const mockProcess = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        })
      };

      (spawn as jest.Mock).mockReturnValue(mockProcess);
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockOutput);

      mysqlManager = new MySQLManager({
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password',
        database: 'mydb'
      });

      await mysqlManager.createBackup('/tmp/backup.sql.gz');

      expect(spawn).toHaveBeenCalledWith('mysqldump', expect.arrayContaining(['mydb']));
      expect(spawn).toHaveBeenCalledWith('mysqldump', expect.not.arrayContaining(['--databases']));
    });

    it('should use --all-databases when neither schemas nor database specified', async () => {
      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 20);
          }
        })
      };
      
      const mockGzip = {
        on: jest.fn(),
        pipe: jest.fn().mockReturnValue(mockOutput)
      };
      
      (zlib.createGzip as jest.Mock).mockReturnValue(mockGzip);
      
      const mockStdout = { 
        pipe: jest.fn().mockReturnValue(mockGzip) 
      };
      
      const mockStderr = { on: jest.fn() };
      const mockProcess = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        })
      };

      (spawn as jest.Mock).mockReturnValue(mockProcess);
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockOutput);

      mysqlManager = new MySQLManager({
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password'
      });

      await mysqlManager.createBackup('/tmp/backup.sql.gz');

      expect(spawn).toHaveBeenCalledWith('mysqldump', expect.arrayContaining(['--all-databases']));
    });

    it('should prefer schemas over database when both are specified', async () => {
      const mockOutput = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 20);
          }
        })
      };
      
      const mockGzip = {
        on: jest.fn(),
        pipe: jest.fn().mockReturnValue(mockOutput)
      };
      
      (zlib.createGzip as jest.Mock).mockReturnValue(mockGzip);
      
      const mockStdout = { 
        pipe: jest.fn().mockReturnValue(mockGzip) 
      };
      
      const mockStderr = { on: jest.fn() };
      const mockProcess = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        })
      };

      (spawn as jest.Mock).mockReturnValue(mockProcess);
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockOutput);

      mysqlManager = new MySQLManager({
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password',
        database: 'mydb',
        schemas: ['schema1', 'schema2']
      });

      await mysqlManager.createBackup('/tmp/backup.sql.gz');

      expect(spawn).toHaveBeenCalledWith('mysqldump', expect.arrayContaining([
        '--databases',
        'schema1',
        'schema2'
      ]));
      expect(spawn).toHaveBeenCalledWith('mysqldump', expect.not.arrayContaining(['mydb']));
    });
  });

  afterEach(() => {
    delete process.env.DB_SCHEMAS;
    delete process.env.DB_HOST;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.S3_BUCKET;
  });
});