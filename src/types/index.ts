export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
}

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  bucket: string;
  key?: string;
  endpointUrl?: string;
}

export interface AppConfig {
  database: DatabaseConfig;
  s3: S3Config;
  verbose?: boolean;
}

export interface BackupInfo {
  key: string;
  lastModified: Date;
  size: number;
  displayName: string;
}

export interface BackupOptions {
  configFile?: string;
  output?: string;
  verbose?: boolean;
}

export interface ListOptions {
  configFile?: string;
  format?: 'table' | 'json';
  verbose?: boolean;
}

export interface RestoreOptions {
  configFile?: string;
  backup?: string;
  database?: string;
  interactive?: boolean;
  force?: boolean;
  verbose?: boolean;
}

export interface ProgressCallback {
  (progress: { loaded: number; total?: number; percentage?: number }): void;
}