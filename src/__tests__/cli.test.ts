// Mock modules - these need to be set up before any imports
jest.mock('chalk', () => ({
  red: jest.fn((str: string) => str),
  blue: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  cyan: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  white: jest.fn((str: string) => str),
  bold: jest.fn((str: string) => str),
  dim: jest.fn((str: string) => str),
  underline: jest.fn((str: string) => str),
  inverse: jest.fn((str: string) => str),
  strikethrough: jest.fn((str: string) => str),
  visible: jest.fn((str: string) => str),
  hidden: jest.fn((str: string) => str),
  black: jest.fn((str: string) => str),
  magenta: jest.fn((str: string) => str),
  bgBlue: jest.fn((str: string) => str),
  bgRed: jest.fn((str: string) => str),
  bgGreen: jest.fn((str: string) => str),
  bgYellow: jest.fn((str: string) => str),
  level: 1,
  supportsColor: { level: 1, hasBasic: true, has256: false, has16m: false }
}));
jest.mock('../commands/backup');
jest.mock('../commands/list');
jest.mock('../commands/restore');

describe('CLI', () => {
  let mockProgram: any;
  let mockBackupCommand: any;
  let mockListCommand: any;
  let mockRestoreCommand: any;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  let processOnSpy: jest.SpyInstance;
  let processArgv: string[];

  // Helper to get fresh module references after reset
  const getCommandModules = () => ({
    backupModule: require('../commands/backup'),
    listModule: require('../commands/list'),
    restoreModule: require('../commands/restore')
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    processOnSpy = jest.spyOn(process, 'on').mockImplementation();

    // Save original argv
    processArgv = process.argv;

    // Create mock command instances
    mockBackupCommand = {
      description: jest.fn().mockReturnThis(),
      option: jest.fn().mockReturnThis(),
      action: jest.fn().mockReturnThis()
    };

    mockListCommand = {
      description: jest.fn().mockReturnThis(),
      option: jest.fn().mockReturnThis(),
      action: jest.fn().mockReturnThis()
    };

    mockRestoreCommand = {
      description: jest.fn().mockReturnThis(),
      option: jest.fn().mockReturnThis(),
      action: jest.fn().mockReturnThis()
    };

    // Setup main program mock
    mockProgram = {
      name: jest.fn().mockReturnThis(),
      description: jest.fn().mockReturnThis(),
      version: jest.fn().mockReturnThis(),
      command: jest.fn().mockImplementation((name: string) => {
        if (name === 'backup') return mockBackupCommand;
        if (name === 'list') return mockListCommand;
        if (name === 'restore') return mockRestoreCommand;
        return mockProgram;
      }),
      parse: jest.fn(),
      outputHelp: jest.fn()
    };

    // Mock commander module with our mockProgram
    jest.doMock('commander', () => ({
      Command: jest.fn().mockImplementation(() => mockProgram)
    }));
  });

  afterEach(() => {
    process.argv = processArgv;
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  describe('CLI initialization', () => {
    it('should initialize program with correct name, description, and version', () => {
      require('../cli');

      expect(mockProgram.name).toHaveBeenCalledWith('mysqldump-s3');
      expect(mockProgram.description).toHaveBeenCalledWith(
        'Node.js CLI tool to dump MySQL databases and upload to Amazon S3, with backup listing and restore functionality'
      );
      expect(mockProgram.version).toHaveBeenCalledWith('1.0.0');
    });

    it('should register all commands', () => {
      require('../cli');

      expect(mockProgram.command).toHaveBeenCalledWith('backup');
      expect(mockProgram.command).toHaveBeenCalledWith('list');
      expect(mockProgram.command).toHaveBeenCalledWith('restore');
    });

    it('should setup global error handlers', () => {
      require('../cli');

      expect(process.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    });
  });

  describe('backup command', () => {
    it('should configure backup command with correct options', () => {
      require('../cli');

      expect(mockBackupCommand.description).toHaveBeenCalledWith(
        'Create a database backup and upload to S3'
      );
      expect(mockBackupCommand.option).toHaveBeenCalledWith(
        '-c, --config <file>',
        'Configuration file path (JSON or YAML)'
      );
      expect(mockBackupCommand.option).toHaveBeenCalledWith(
        '-s, --schemas <schemas>',
        'Comma-separated list of schemas to backup'
      );
      expect(mockBackupCommand.option).toHaveBeenCalledWith(
        '-n, --name <name>',
        'Custom backup name (without extension)'
      );
      expect(mockBackupCommand.option).toHaveBeenCalledWith(
        '-v, --verbose',
        'Enable verbose output'
      );
    });

    it('should call backupCommand when action is triggered', async () => {
      const { backupModule } = getCommandModules();
      require('../cli');

      const actionHandler = mockBackupCommand.action.mock.calls[0][0];
      const options = {
        config: 'config.json',
        schemas: 'db1,db2',
        name: 'custom-backup',
        verbose: true
      };

      await actionHandler(options);

      expect(backupModule.backupCommand).toHaveBeenCalledWith(options);
    });
  });

  describe('list command', () => {
    it('should configure list command with correct options', () => {
      require('../cli');

      expect(mockListCommand.description).toHaveBeenCalledWith(
        'List available backups in S3'
      );
      expect(mockListCommand.option).toHaveBeenCalledWith(
        '-c, --config <file>',
        'Configuration file path (JSON or YAML)'
      );
      expect(mockListCommand.option).toHaveBeenCalledWith(
        '-f, --format <format>',
        'Output format (table|json)',
        'table'
      );
      expect(mockListCommand.option).toHaveBeenCalledWith(
        '-v, --verbose',
        'Enable verbose output'
      );
    });

    it('should validate format and call listCommand for valid format', async () => {
      const { listModule } = getCommandModules();
      require('../cli');

      const actionHandler = mockListCommand.action.mock.calls[0][0];
      const options = {
        config: 'config.json',
        format: 'json',
        verbose: false
      };

      await actionHandler(options);

      expect(listModule.listCommand).toHaveBeenCalledWith(options);
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should reject invalid format', async () => {
      const { listModule } = getCommandModules();
      require('../cli');

      const actionHandler = mockListCommand.action.mock.calls[0][0];
      const options = {
        config: 'config.json',
        format: 'invalid',
        verbose: false
      };

      await actionHandler(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid format. Use "table" or "json"')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(listModule.listCommand).not.toHaveBeenCalled();
    });

    it('should accept table format', async () => {
      const { listModule } = getCommandModules();
      require('../cli');

      const actionHandler = mockListCommand.action.mock.calls[0][0];
      const options = {
        format: 'table'
      };

      await actionHandler(options);

      expect(listModule.listCommand).toHaveBeenCalledWith(options);
      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });

  describe('restore command', () => {
    it('should configure restore command with correct options', () => {
      require('../cli');

      expect(mockRestoreCommand.description).toHaveBeenCalledWith(
        'Restore a backup from S3 to MySQL database'
      );
      expect(mockRestoreCommand.option).toHaveBeenCalledWith(
        '-c, --config <file>',
        'Configuration file path (JSON or YAML)'
      );
      expect(mockRestoreCommand.option).toHaveBeenCalledWith(
        '-b, --backup <key>',
        'S3 backup key to restore (required for non-interactive mode)'
      );
      expect(mockRestoreCommand.option).toHaveBeenCalledWith(
        '-d, --database <name>',
        'Target database name (required for non-interactive mode)'
      );
      expect(mockRestoreCommand.option).toHaveBeenCalledWith(
        '--non-interactive',
        'Run in non-interactive mode'
      );
      expect(mockRestoreCommand.option).toHaveBeenCalledWith(
        '--force',
        'Skip confirmation prompts'
      );
      expect(mockRestoreCommand.option).toHaveBeenCalledWith(
        '-v, --verbose',
        'Enable verbose output'
      );
    });

    it('should call restoreCommand with interactive mode by default', async () => {
      const { restoreModule } = getCommandModules();
      require('../cli');

      const actionHandler = mockRestoreCommand.action.mock.calls[0][0];
      const options = {
        config: 'config.json',
        backup: 'backup.sql.gz',
        database: 'testdb',
        force: false,
        verbose: true
      };

      await actionHandler(options);

      expect(restoreModule.restoreCommand).toHaveBeenCalledWith({
        ...options,
        interactive: true
      });
    });

    it('should call restoreCommand with non-interactive mode when specified', async () => {
      const { restoreModule } = getCommandModules();
      require('../cli');

      const actionHandler = mockRestoreCommand.action.mock.calls[0][0];
      const options = {
        config: 'config.json',
        backup: 'backup.sql.gz',
        database: 'testdb',
        nonInteractive: true,
        force: true,
        verbose: false
      };

      await actionHandler(options);

      expect(restoreModule.restoreCommand).toHaveBeenCalledWith({
        config: 'config.json',
        backup: 'backup.sql.gz',
        database: 'testdb',
        nonInteractive: true,
        force: true,
        verbose: false,
        interactive: false
      });
    });
  });

  describe('error handlers', () => {
    it('should handle uncaught exceptions', () => {
      require('../cli');

      const uncaughtHandler = processOnSpy.mock.calls.find(
        call => call[0] === 'uncaughtException'
      )[1];

      const error = new Error('Test uncaught exception');
      uncaughtHandler(error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Uncaught exception:'),
        'Test uncaught exception'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle unhandled rejections', () => {
      require('../cli');

      const rejectionHandler = processOnSpy.mock.calls.find(
        call => call[0] === 'unhandledRejection'
      )[1];

      // Create a mock promise object to avoid actual unhandled rejection
      const mockPromise = { then: jest.fn(), catch: jest.fn() };
      const reason = 'Test rejection';
      rejectionHandler(reason, mockPromise);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled rejection at:'),
        mockPromise,
        'reason:',
        reason
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('help output', () => {
    it('should show help when no arguments provided', () => {
      process.argv = ['node', 'cli.js'];
      
      require('../cli');

      expect(mockProgram.outputHelp).toHaveBeenCalled();
    });

    it('should not show help when command is provided', () => {
      process.argv = ['node', 'cli.js', 'backup'];
      
      require('../cli');

      expect(mockProgram.outputHelp).not.toHaveBeenCalled();
    });
  });

  describe('command line parsing', () => {
    it('should parse command line arguments', () => {
      process.argv = ['node', 'cli.js', 'backup', '--verbose'];
      
      require('../cli');

      expect(mockProgram.parse).toHaveBeenCalled();
    });
  });
});