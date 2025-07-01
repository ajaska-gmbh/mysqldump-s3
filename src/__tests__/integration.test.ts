/**
 * Integration tests for the CLI commands
 * Tests module imports and exports without requiring real services
 */

describe('CLI Integration Tests', () => {
  // Simple test to verify the command files can be imported
  it('should import all command modules successfully', () => {
    expect(() => require('../commands/backup')).not.toThrow();
    expect(() => require('../commands/list')).not.toThrow();
    expect(() => require('../commands/restore')).not.toThrow();
  });

  it('should have all expected exports', () => {
    const backup = require('../commands/backup');
    const list = require('../commands/list');
    const restore = require('../commands/restore');

    expect(typeof backup.backupCommand).toBe('function');
    expect(typeof list.listCommand).toBe('function');
    expect(typeof restore.restoreCommand).toBe('function');
  });

});