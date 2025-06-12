import { ProgressTracker } from '../modules/progress';

// Mock cli-progress
jest.mock('cli-progress', () => ({
  SingleBar: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    update: jest.fn(),
    setTotal: jest.fn()
  }))
}));

// Mock chalk
jest.mock('chalk', () => ({
  cyan: jest.fn((text) => text),
  blue: jest.fn((text) => text),
  yellow: jest.fn((text) => text),
  red: jest.fn((text) => text)
}));

describe('ProgressTracker', () => {
  let progressTracker: ProgressTracker;
  let mockProgressBar: any;

  beforeEach(() => {
    const cliProgress = require('cli-progress');
    mockProgressBar = {
      start: jest.fn(),
      stop: jest.fn(),
      update: jest.fn(),
      setTotal: jest.fn()
    };
    cliProgress.SingleBar.mockImplementation(() => mockProgressBar);
    
    progressTracker = new ProgressTracker();
    
    // Mock console.log
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createProgressBar', () => {
    it('should create progress bar with total value', () => {
      const callback = progressTracker.createProgressBar('Test', 100);

      expect(mockProgressBar.start).toHaveBeenCalledWith(100, 0);
      expect(typeof callback).toBe('function');
    });

    it('should create progress bar without total value', () => {
      const callback = progressTracker.createProgressBar('Test');

      expect(mockProgressBar.start).toHaveBeenCalledWith(100, 0);
      expect(typeof callback).toBe('function');
    });

    it('should handle progress updates with total', () => {
      const callback = progressTracker.createProgressBar('Test', 100);
      
      callback({ loaded: 50, total: 100, percentage: 50 });

      expect(mockProgressBar.setTotal).toHaveBeenCalledWith(100);
      expect(mockProgressBar.update).toHaveBeenCalledWith(50);
    });

    it('should handle progress updates with percentage only', () => {
      const callback = progressTracker.createProgressBar('Test');
      
      callback({ loaded: 0, total: 0, percentage: 75 });

      expect(mockProgressBar.update).toHaveBeenCalledWith(75);
    });
  });

  describe('createStreamProgressBar', () => {
    let mockStdoutWrite: jest.SpyInstance;

    beforeEach(() => {
      mockStdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation();
    });

    it('should create stream progress bar callback', () => {
      const callback = progressTracker.createStreamProgressBar('Upload');
      expect(typeof callback).toBe('function');
    });

    it('should update stream progress for large chunks', () => {
      const callback = progressTracker.createStreamProgressBar('Upload');
      
      callback({ 
        loaded: 2 * 1024 * 1024, // 2MB
        total: 10 * 1024 * 1024, // 10MB
        percentage: 20 
      });

      expect(mockStdoutWrite).toHaveBeenCalled();
    });

    it('should show completion message', () => {
      const callback = progressTracker.createStreamProgressBar('Upload');
      
      callback({ 
        loaded: 10 * 1024 * 1024, // 10MB
        total: 10 * 1024 * 1024, // 10MB
        percentage: 100 
      });

      expect(mockStdoutWrite).toHaveBeenCalledWith('\n');
    });
  });

  describe('stop', () => {
    it('should stop active progress bar', () => {
      progressTracker.createProgressBar('Test');
      progressTracker.stop();

      expect(mockProgressBar.stop).toHaveBeenCalled();
    });

    it('should handle stop when no progress bar exists', () => {
      expect(() => progressTracker.stop()).not.toThrow();
    });
  });

  describe('log', () => {
    it('should log info message', () => {
      progressTracker.log('Test message', 'info');
      expect(console.log).toHaveBeenCalledWith('ℹ Test message');
    });

    it('should log warning message', () => {
      progressTracker.log('Warning message', 'warn');
      expect(console.log).toHaveBeenCalledWith('⚠ Warning message');
    });

    it('should log error message', () => {
      progressTracker.log('Error message', 'error');
      expect(console.log).toHaveBeenCalledWith('✗ Error message');
    });

    it('should default to info level', () => {
      progressTracker.log('Default message');
      expect(console.log).toHaveBeenCalledWith('ℹ Default message');
    });

    it('should handle logging with active progress bar', () => {
      progressTracker.createProgressBar('Test');
      progressTracker.log('Test message');

      expect(mockProgressBar.stop).toHaveBeenCalled();
      expect(mockProgressBar.start).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('ℹ Test message');
    });
  });
});