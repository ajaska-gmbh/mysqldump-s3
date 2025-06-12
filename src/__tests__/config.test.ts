import { ConfigManager } from '../modules/config';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn()
}));

// Mock js-yaml
jest.mock('js-yaml', () => ({
  load: jest.fn()
}));

describe('ConfigManager', () => {
  let configManager: ConfigManager;

  beforeEach(() => {
    configManager = ConfigManager.getInstance();
    configManager.reset();
    // Clear environment variables
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    delete process.env.S3_BUCKET;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.S3_KEY;
    delete process.env.S3_ENDPOINT_URL;
    
    jest.clearAllMocks();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = ConfigManager.getInstance();
      const instance2 = ConfigManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('loadFromEnvironment', () => {
    it('should load configuration from environment variables', () => {
      // Set up environment variables
      process.env.DB_HOST = 'test-host';
      process.env.DB_PORT = '3307';
      process.env.DB_USER = 'test-user';
      process.env.DB_PASSWORD = 'test-password';
      process.env.DB_NAME = 'test-db';
      process.env.AWS_ACCESS_KEY_ID = 'test-key-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.AWS_DEFAULT_REGION = 'us-west-2';
      process.env.S3_KEY = 'custom-key';
      process.env.S3_ENDPOINT_URL = 'https://custom-s3.example.com';

      const config = configManager.loadConfig();

      expect(config.database.host).toBe('test-host');
      expect(config.database.port).toBe(3307);
      expect(config.database.user).toBe('test-user');
      expect(config.database.password).toBe('test-password');
      expect(config.database.database).toBe('test-db');
      expect(config.s3.accessKeyId).toBe('test-key-id');
      expect(config.s3.secretAccessKey).toBe('test-secret');
      expect(config.s3.bucket).toBe('test-bucket');
      expect(config.s3.region).toBe('us-west-2');
      expect(config.s3.key).toBe('custom-key');
      expect(config.s3.endpointUrl).toBe('https://custom-s3.example.com');
    });

    it('should use default values for optional fields', () => {
      // Set up minimum required environment variables
      process.env.DB_HOST = 'test-host';
      process.env.DB_USER = 'test-user';
      process.env.DB_PASSWORD = 'test-password';
      process.env.AWS_ACCESS_KEY_ID = 'test-key-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      // Clear DB_PORT to test default
      delete process.env.DB_PORT;

      const config = configManager.loadConfig();

      expect(config.database.port).toBe(3306); // default port
      expect(config.database.database).toBeUndefined();
      expect(config.s3.region).toBeUndefined();
      expect(config.s3.key).toBeUndefined();
      expect(config.s3.endpointUrl).toBeUndefined();
    });

    it('should throw error for missing required fields', () => {
      expect(() => {
        configManager.loadConfig();
      }).toThrow('Configuration validation failed');
    });

    it('should throw error for missing database host', () => {
      process.env.DB_USER = 'test-user';
      process.env.DB_PASSWORD = 'test-password';
      process.env.AWS_ACCESS_KEY_ID = 'test-key-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';

      expect(() => {
        configManager.loadConfig();
      }).toThrow('Database host is required (DB_HOST)');
    });

    it('should throw error for missing S3 credentials', () => {
      process.env.DB_HOST = 'test-host';
      process.env.DB_USER = 'test-user';
      process.env.DB_PASSWORD = 'test-password';

      expect(() => {
        configManager.loadConfig();
      }).toThrow('AWS access key ID is required (AWS_ACCESS_KEY_ID)');
    });
  });

  describe('loadFromFile', () => {
    it('should load configuration from JSON file', () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        database: {
          host: 'file-host',
          port: 3307,
          user: 'file-user',
          password: 'file-password'
        },
        s3: {
          bucket: 'file-bucket',
          accessKeyId: 'file-key',
          secretAccessKey: 'file-secret'
        }
      }));

      // Set minimum env vars for validation
      process.env.DB_HOST = 'env-host';
      process.env.DB_USER = 'env-user';
      process.env.DB_PASSWORD = 'env-password';
      process.env.AWS_ACCESS_KEY_ID = 'env-key-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'env-secret';
      process.env.S3_BUCKET = 'env-bucket';

      const config = configManager.loadConfig('config.json');

      // Environment variables should take precedence
      expect(config.database.host).toBe('env-host');
      expect(config.s3.bucket).toBe('env-bucket');
    });

    it('should load configuration from YAML file', () => {
      const fs = require('fs');
      const yaml = require('js-yaml');
      
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('database:\n  host: yaml-host');
      yaml.load.mockReturnValue({
        database: {
          host: 'yaml-host',
          user: 'yaml-user',
          password: 'yaml-password'
        },
        s3: {
          bucket: 'yaml-bucket',
          accessKeyId: 'yaml-key',
          secretAccessKey: 'yaml-secret'
        }
      });

      // Set minimum env vars for validation
      process.env.DB_HOST = 'env-host';
      process.env.DB_USER = 'env-user';
      process.env.DB_PASSWORD = 'env-password';
      process.env.AWS_ACCESS_KEY_ID = 'env-key-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'env-secret';
      process.env.S3_BUCKET = 'env-bucket';

      const config = configManager.loadConfig('config.yml');

      expect(yaml.load).toHaveBeenCalled();
      expect(config.database.host).toBe('env-host'); // env takes precedence
    });

    it('should handle non-existent config file', () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);

      // Set minimum env vars for validation
      process.env.DB_HOST = 'env-host';
      process.env.DB_USER = 'env-user';
      process.env.DB_PASSWORD = 'env-password';
      process.env.AWS_ACCESS_KEY_ID = 'env-key-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'env-secret';
      process.env.S3_BUCKET = 'env-bucket';

      const config = configManager.loadConfig('nonexistent.json');

      expect(config.database.host).toBe('env-host');
    });
  });

  describe('generateS3Key', () => {
    it('should generate S3 key with database name', () => {
      const key = configManager.generateS3Key('mydb');
      expect(key).toMatch(/^mydb-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql\.gz$/);
    });

    it('should generate S3 key without database name', () => {
      const key = configManager.generateS3Key();
      expect(key).toMatch(/^all-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql\.gz$/);
    });

    it('should generate unique keys', (done) => {
      const key1 = configManager.generateS3Key('test');
      
      // Wait a small amount to ensure timestamp difference
      setTimeout(() => {
        const key2 = configManager.generateS3Key('test');
        expect(key1).not.toBe(key2);
        done();
      }, 10);
    });
  });

  describe('reset', () => {
    it('should reset cached configuration', () => {
      // Load config first
      process.env.DB_HOST = 'test-host';
      process.env.DB_USER = 'test-user';
      process.env.DB_PASSWORD = 'test-password';
      process.env.AWS_ACCESS_KEY_ID = 'test-key-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';

      const config1 = configManager.loadConfig();
      
      // Reset and change env vars
      configManager.reset();
      process.env.DB_HOST = 'different-host';
      
      const config2 = configManager.loadConfig();
      
      expect(config1.database.host).toBe('test-host');
      expect(config2.database.host).toBe('different-host');
    });
  });

  describe('config merging', () => {
    it('should prioritize environment variables over file config', () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        database: {
          host: 'file-host',
          port: 3307,
          user: 'file-user',
          password: 'file-password'
        },
        s3: {
          bucket: 'file-bucket',
          accessKeyId: 'file-key',
          secretAccessKey: 'file-secret'
        }
      }));

      // Set only some env vars
      process.env.DB_HOST = 'env-host';
      process.env.DB_USER = 'env-user';
      process.env.DB_PASSWORD = 'env-password';
      process.env.AWS_ACCESS_KEY_ID = 'env-key-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'env-secret';
      process.env.S3_BUCKET = 'env-bucket';

      const config = configManager.loadConfig('config.json');

      // Env vars should override file config
      expect(config.database.host).toBe('env-host');
      expect(config.database.user).toBe('env-user');
      expect(config.s3.bucket).toBe('env-bucket');
      
      // File config should be used where no env var is set
      expect(config.database.port).toBe(3307);
    });
  });
});