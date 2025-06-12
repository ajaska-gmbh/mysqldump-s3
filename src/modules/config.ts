import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AppConfig, DatabaseConfig, S3Config } from '../types';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: AppConfig | null = null;

  private constructor() {}

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public loadConfig(configFile?: string): AppConfig {
    if (this.config) {
      return this.config;
    }

    // Load from config file if provided
    let fileConfig: Partial<AppConfig> = {};
    if (configFile && fs.existsSync(configFile)) {
      const content = fs.readFileSync(configFile, 'utf8');
      const ext = path.extname(configFile).toLowerCase();
      
      if (ext === '.yaml' || ext === '.yml') {
        fileConfig = yaml.load(content) as Partial<AppConfig>;
      } else if (ext === '.json') {
        fileConfig = JSON.parse(content);
      }
    }

    // Load from environment variables (override file config)
    const envConfig = this.loadFromEnvironment();

    // Merge configurations (env variables take precedence)
    this.config = this.mergeConfigs(fileConfig, envConfig);
    
    // Validate required fields
    this.validateConfig(this.config);
    
    return this.config;
  }

  private loadFromEnvironment(): Partial<AppConfig> {
    const database: Partial<DatabaseConfig> = {};
    const s3: Partial<S3Config> = {};

    // Database configuration
    if (process.env.DB_HOST) database.host = process.env.DB_HOST;
    if (process.env.DB_PORT) database.port = parseInt(process.env.DB_PORT, 10);
    if (process.env.DB_USER) database.user = process.env.DB_USER;
    if (process.env.DB_PASSWORD) database.password = process.env.DB_PASSWORD;
    if (process.env.DB_NAME) database.database = process.env.DB_NAME;

    // S3 configuration
    if (process.env.AWS_ACCESS_KEY_ID) s3.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    if (process.env.AWS_SECRET_ACCESS_KEY) s3.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (process.env.AWS_DEFAULT_REGION) s3.region = process.env.AWS_DEFAULT_REGION;
    if (process.env.S3_BUCKET) s3.bucket = process.env.S3_BUCKET;
    if (process.env.S3_KEY) s3.key = process.env.S3_KEY;
    if (process.env.S3_ENDPOINT_URL) s3.endpointUrl = process.env.S3_ENDPOINT_URL;

    return {
      database: database as DatabaseConfig,
      s3: s3 as S3Config
    };
  }

  private mergeConfigs(fileConfig: Partial<AppConfig>, envConfig: Partial<AppConfig>): AppConfig {
    return {
      database: {
        host: envConfig.database?.host || fileConfig.database?.host || '',
        port: envConfig.database?.port || fileConfig.database?.port || 3306,
        user: envConfig.database?.user || fileConfig.database?.user || '',
        password: envConfig.database?.password || fileConfig.database?.password || '',
        database: envConfig.database?.database || fileConfig.database?.database
      },
      s3: {
        accessKeyId: envConfig.s3?.accessKeyId || fileConfig.s3?.accessKeyId || '',
        secretAccessKey: envConfig.s3?.secretAccessKey || fileConfig.s3?.secretAccessKey || '',
        region: envConfig.s3?.region || fileConfig.s3?.region,
        bucket: envConfig.s3?.bucket || fileConfig.s3?.bucket || '',
        key: envConfig.s3?.key || fileConfig.s3?.key,
        endpointUrl: envConfig.s3?.endpointUrl || fileConfig.s3?.endpointUrl
      },
      verbose: envConfig.verbose || fileConfig.verbose || false
    };
  }

  private validateConfig(config: AppConfig): void {
    const errors: string[] = [];

    // Validate database config
    if (!config.database.host) errors.push('Database host is required (DB_HOST)');
    if (!config.database.user) errors.push('Database user is required (DB_USER)');
    if (!config.database.password) errors.push('Database password is required (DB_PASSWORD)');

    // Validate S3 config
    if (!config.s3.accessKeyId) errors.push('AWS access key ID is required (AWS_ACCESS_KEY_ID)');
    if (!config.s3.secretAccessKey) errors.push('AWS secret access key is required (AWS_SECRET_ACCESS_KEY)');
    if (!config.s3.bucket) errors.push('S3 bucket is required (S3_BUCKET)');

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  public generateS3Key(database?: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = database || 'all';
    return `${prefix}-${timestamp}.sql.gz`;
  }

  public reset(): void {
    this.config = null;
  }
}