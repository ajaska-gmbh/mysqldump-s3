import { ConfigManager } from '../modules/config';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

jest.mock('fs');
jest.mock('js-yaml');

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    // Clear all environment variables
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('DB_') || key.startsWith('MYSQL_') || 
          key.startsWith('S3_') || key.startsWith('AWS_')) {
        delete process.env[key];
      }
    });
    // Reset singleton instance
    ConfigManager['instance'] = undefined as any;
    configManager = ConfigManager.getInstance();
  });

  afterEach(() => {
    process.env = originalEnv;
    configManager.reset();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = ConfigManager.getInstance();
      const instance2 = ConfigManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('loadConfig from environment', () => {
    it('should load database config from DB_ prefixed env vars', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '3307';
      process.env.DB_USER = 'testuser';
      process.env.DB_PASSWORD = 'testpass';
      process.env.DB_NAME = 'testdb';
      process.env.DB_SCHEMAS = 'schema1,schema2';
      // Add required S3 config to pass validation
      process.env.S3_ACCESS_KEY_ID = 's3-key';
      process.env.S3_SECRET_ACCESS_KEY = 's3-secret';
      process.env.S3_BUCKET = 'test-bucket';

      const config = configManager.loadConfig();

      expect(config.database).toEqual({
        host: 'localhost',
        port: 3307,
        user: 'testuser',
        password: 'testpass',
        database: 'testdb',
        schemas: ['schema1', 'schema2']
      });
    });

    it('should load database config from MYSQL_ prefixed env vars', () => {
      process.env.MYSQL_HOST = 'mysql-host';
      process.env.MYSQL_PORT = '3308';
      process.env.MYSQL_USER = 'mysqluser';
      process.env.MYSQL_PASSWORD = 'mysqlpass';
      process.env.MYSQL_DATABASE = 'mysqldb';
      process.env.MYSQL_SCHEMAS = 'prod,staging';
      // Add required S3 config to pass validation
      process.env.S3_ACCESS_KEY_ID = 's3-key';
      process.env.S3_SECRET_ACCESS_KEY = 's3-secret';
      process.env.S3_BUCKET = 'test-bucket';

      const config = configManager.loadConfig();

      expect(config.database).toEqual({
        host: 'mysql-host',
        port: 3308,
        user: 'mysqluser',
        password: 'mysqlpass',
        database: 'mysqldb',
        schemas: ['prod', 'staging']
      });
    });

    it('should prefer DB_ over MYSQL_ prefixed env vars', () => {
      process.env.DB_HOST = 'db-host';
      process.env.MYSQL_HOST = 'mysql-host';
      process.env.DB_USER = 'dbuser';
      process.env.MYSQL_USER = 'mysqluser';
      process.env.DB_PASSWORD = 'dbpass';
      process.env.MYSQL_PASSWORD = 'mysqlpass';
      // Add required S3 config to pass validation
      process.env.S3_ACCESS_KEY_ID = 's3-key';
      process.env.S3_SECRET_ACCESS_KEY = 's3-secret';
      process.env.S3_BUCKET = 'test-bucket';

      const config = configManager.loadConfig();

      expect(config.database.host).toBe('db-host');
      expect(config.database.user).toBe('dbuser');
      expect(config.database.password).toBe('dbpass');
    });

    it('should load S3 config from S3_ prefixed env vars', () => {
      process.env.S3_ACCESS_KEY_ID = 's3-key';
      process.env.S3_SECRET_ACCESS_KEY = 's3-secret';
      process.env.S3_REGION = 'us-west-1';
      process.env.S3_BUCKET = 'my-bucket';
      process.env.S3_KEY = 'backup-key';
      process.env.S3_ENDPOINT_URL = 'http://localhost:9000';
      // Set required database env vars to avoid validation errors
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';

      const config = configManager.loadConfig();

      expect(config.s3).toEqual({
        accessKeyId: 's3-key',
        secretAccessKey: 's3-secret',
        region: 'us-west-1',
        bucket: 'my-bucket',
        key: 'backup-key',
        endpointUrl: 'http://localhost:9000'
      });
    });

    it('should load S3 config from AWS_ prefixed env vars', () => {
      process.env.AWS_ACCESS_KEY_ID = 'aws-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
      process.env.AWS_DEFAULT_REGION = 'eu-west-1';
      process.env.S3_BUCKET = 'aws-bucket';
      // Set required database env vars
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';

      const config = configManager.loadConfig();

      expect(config.s3.accessKeyId).toBe('aws-key');
      expect(config.s3.secretAccessKey).toBe('aws-secret');
      expect(config.s3.region).toBe('eu-west-1');
      expect(config.s3.bucket).toBe('aws-bucket');
    });

    it('should prefer S3_ over AWS_ prefixed env vars', () => {
      process.env.S3_ACCESS_KEY_ID = 's3-key';
      process.env.AWS_ACCESS_KEY_ID = 'aws-key';
      process.env.S3_SECRET_ACCESS_KEY = 's3-secret';
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
      process.env.S3_BUCKET = 'my-bucket';
      // Set required database env vars
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';

      const config = configManager.loadConfig();

      expect(config.s3.accessKeyId).toBe('s3-key');
      expect(config.s3.secretAccessKey).toBe('s3-secret');
    });

    it('should handle schemas with spaces', () => {
      process.env.DB_SCHEMAS = ' schema1 , schema2 , schema3 ';
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';
      process.env.S3_ACCESS_KEY_ID = 'key';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const config = configManager.loadConfig();

      expect(config.database.schemas).toEqual(['schema1', 'schema2', 'schema3']);
    });

    it('should use default port when not specified', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';
      process.env.S3_ACCESS_KEY_ID = 'key';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const config = configManager.loadConfig();

      expect(config.database.port).toBe(3306);
    });
  });

  describe('loadConfig from file', () => {
    it('should load config from JSON file', () => {
      const jsonConfig = {
        database: {
          host: 'json-host',
          port: 3309,
          user: 'json-user',
          password: 'json-pass',
          database: 'json-db'
        },
        s3: {
          accessKeyId: 'json-key',
          secretAccessKey: 'json-secret',
          region: 'ap-south-1',
          bucket: 'json-bucket'
        }
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(jsonConfig));

      const config = configManager.loadConfig('config.json');

      expect(config.database.host).toBe('json-host');
      expect(config.database.port).toBe(3309);
      expect(config.s3.bucket).toBe('json-bucket');
    });

    it('should load config from YAML file', () => {
      const yamlConfig = {
        database: {
          host: 'yaml-host',
          port: 3310,
          user: 'yaml-user',
          password: 'yaml-pass',
          database: 'yaml-db'
        },
        s3: {
          accessKeyId: 'yaml-key',
          secretAccessKey: 'yaml-secret',
          region: 'ca-central-1',
          bucket: 'yaml-bucket'
        }
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('yaml content');
      (yaml.load as jest.Mock).mockReturnValue(yamlConfig);

      const config = configManager.loadConfig('config.yaml');

      expect(yaml.load).toHaveBeenCalledWith('yaml content');
      expect(config.database.host).toBe('yaml-host');
      expect(config.s3.bucket).toBe('yaml-bucket');
    });

    it('should handle YML extension', () => {
      const yamlConfig = {
        database: {
          host: 'yml-host',
          user: 'yml-user',
          password: 'yml-pass'
        },
        s3: {
          accessKeyId: 'yml-key',
          secretAccessKey: 'yml-secret',
          bucket: 'yml-bucket'
        }
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('yml content');
      (yaml.load as jest.Mock).mockReturnValue(yamlConfig);

      const config = configManager.loadConfig('config.yml');

      expect(yaml.load).toHaveBeenCalledWith('yml content');
      expect(config.database.host).toBe('yml-host');
    });

    it('should handle non-existent config file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      
      // Set required env vars
      process.env.DB_HOST = 'env-host';
      process.env.DB_USER = 'env-user';
      process.env.DB_PASSWORD = 'env-pass';
      process.env.S3_ACCESS_KEY_ID = 'env-key';
      process.env.S3_SECRET_ACCESS_KEY = 'env-secret';
      process.env.S3_BUCKET = 'env-bucket';

      const config = configManager.loadConfig('non-existent.json');

      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(config.database.host).toBe('env-host');
    });

    it('should prefer env vars over file config', () => {
      const fileConfig = {
        database: {
          host: 'file-host',
          user: 'file-user',
          password: 'file-pass'
        },
        s3: {
          accessKeyId: 'file-key',
          secretAccessKey: 'file-secret',
          bucket: 'file-bucket'
        }
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(fileConfig));

      process.env.DB_HOST = 'env-host';
      process.env.S3_BUCKET = 'env-bucket';

      const config = configManager.loadConfig('config.json');

      expect(config.database.host).toBe('env-host');
      expect(config.database.user).toBe('file-user');
      expect(config.s3.bucket).toBe('env-bucket');
      expect(config.s3.accessKeyId).toBe('file-key');
    });

    it('should prefer file database name over env for database property', () => {
      const fileConfig = {
        database: {
          host: 'file-host',
          user: 'file-user',
          password: 'file-pass',
          database: 'file-db'
        },
        s3: {
          accessKeyId: 'file-key',
          secretAccessKey: 'file-secret',
          bucket: 'file-bucket'
        }
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(fileConfig));

      process.env.DB_NAME = 'env-db';

      const config = configManager.loadConfig('config.json');

      expect(config.database.database).toBe('file-db');
    });
  });

  describe('validation', () => {
    it('should validate required database fields when requireDatabase is true', () => {
      process.env.S3_ACCESS_KEY_ID = 'key';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      expect(() => configManager.loadConfig(undefined, { requireDatabase: true, requireS3: true }))
        .toThrow('Configuration validation failed');
    });

    it('should validate required S3 fields when requireS3 is true', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';

      expect(() => configManager.loadConfig(undefined, { requireDatabase: true, requireS3: true }))
        .toThrow('Configuration validation failed');
    });

    it('should skip database validation when requireDatabase is false', () => {
      process.env.S3_ACCESS_KEY_ID = 'key';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const config = configManager.loadConfig(undefined, { requireDatabase: false, requireS3: true });

      expect(config.s3.bucket).toBe('bucket');
    });

    it('should skip S3 validation when requireS3 is false', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';

      const config = configManager.loadConfig(undefined, { requireDatabase: true, requireS3: false });

      expect(config.database.host).toBe('localhost');
    });

    it('should require both by default when no context provided', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';
      // Missing S3 config

      expect(() => configManager.loadConfig()).toThrow('Configuration validation failed');
    });

    it('should provide detailed error messages', () => {
      try {
        configManager.loadConfig(undefined, { requireDatabase: true, requireS3: true });
      } catch (error: any) {
        expect(error.message).toContain('Database host is required');
        expect(error.message).toContain('Database user is required');
        expect(error.message).toContain('Database password is required');
        expect(error.message).toContain('AWS access key ID is required');
        expect(error.message).toContain('AWS secret access key is required');
        expect(error.message).toContain('S3 bucket is required');
      }
    });
  });

  describe('caching behavior', () => {
    it('should cache config after first load', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';
      process.env.S3_ACCESS_KEY_ID = 'key';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const config1 = configManager.loadConfig();
      
      // Change env vars
      process.env.DB_HOST = 'changed-host';
      
      const config2 = configManager.loadConfig();

      expect(config1).toBe(config2);
      expect(config2.database.host).toBe('localhost'); // Still cached value
    });

    it('should reload config when different config file is provided', () => {
      const config1 = {
        database: { host: 'host1', user: 'user1', password: 'pass1' },
        s3: { accessKeyId: 'key1', secretAccessKey: 'secret1', bucket: 'bucket1' }
      };

      const config2 = {
        database: { host: 'host2', user: 'user2', password: 'pass2' },
        s3: { accessKeyId: 'key2', secretAccessKey: 'secret2', bucket: 'bucket2' }
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock)
        .mockReturnValueOnce(JSON.stringify(config1))
        .mockReturnValueOnce(JSON.stringify(config2));

      const result1 = configManager.loadConfig('config1.json');
      const result2 = configManager.loadConfig('config2.json');

      expect(result1.database.host).toBe('host1');
      expect(result2.database.host).toBe('host2');
    });

    it('should reset config when reset is called', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';
      process.env.S3_ACCESS_KEY_ID = 'key';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      configManager.loadConfig();

      configManager.reset();
      
      // Change env vars
      process.env.DB_HOST = 'new-host';
      
      const config2 = configManager.loadConfig();

      expect(config2.database.host).toBe('new-host');
    });
  });

  describe('generateS3Key', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2023-12-01T10:30:45.123Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should generate key with database name', () => {
      const key = configManager.generateS3Key('mydb');
      expect(key).toBe('mydb-2023-12-01T10-30-45-123Z.sql.gz');
    });

    it('should generate key with schemas', () => {
      const key = configManager.generateS3Key(undefined, ['schema1', 'schema2']);
      expect(key).toBe('schema1-schema2-2023-12-01T10-30-45-123Z.sql.gz');
    });

    it('should prefer schemas over database name', () => {
      const key = configManager.generateS3Key('mydb', ['schema1', 'schema2']);
      expect(key).toBe('schema1-schema2-2023-12-01T10-30-45-123Z.sql.gz');
    });

    it('should use "all" as default prefix', () => {
      const key = configManager.generateS3Key();
      expect(key).toBe('all-2023-12-01T10-30-45-123Z.sql.gz');
    });

    it('should handle empty schemas array', () => {
      const key = configManager.generateS3Key('testdb', []);
      expect(key).toBe('testdb-2023-12-01T10-30-45-123Z.sql.gz');
    });
  });

  describe('verbose configuration', () => {
    it('should default verbose to false', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_USER = 'user';
      process.env.DB_PASSWORD = 'pass';
      process.env.S3_ACCESS_KEY_ID = 'key';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const config = configManager.loadConfig();
      expect(config.verbose).toBe(false);
    });

    it('should load verbose from file config', () => {
      const fileConfig = {
        database: { host: 'host', user: 'user', password: 'pass' },
        s3: { accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' },
        verbose: true
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(fileConfig));

      const config = configManager.loadConfig('config.json');
      expect(config.verbose).toBe(true);
    });
  });
});