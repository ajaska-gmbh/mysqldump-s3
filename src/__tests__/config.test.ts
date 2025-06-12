import { ConfigManager } from '../modules/config';

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
    });

    it('should throw error for missing required fields', () => {
      expect(() => {
        configManager.loadConfig();
      }).toThrow('Configuration validation failed');
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
  });
});