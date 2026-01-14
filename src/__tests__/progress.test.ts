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
      const callback = progressTracker.createProgressBar('Test', 50);
      
      // Test with 100% completion to bypass throttling
      callback({ loaded: 200, total: 200, percentage: 100 });

      expect(mockProgressBar.setTotal).toHaveBeenCalledWith(200);
      expect(mockProgressBar.update).toHaveBeenCalledWith(200);
    });

    it('should handle progress updates with percentage only', () => {
      const callback = progressTracker.createProgressBar('Test');
      
      // Test with percentage only (no total or loaded properties)
      callback({ percentage: 100 });

      expect(mockProgressBar.update).toHaveBeenCalledWith(100);
    });

    it('should handle streaming progress with unknown total', () => {
      jest.useFakeTimers();
      const callback = progressTracker.createProgressBar('Test');

      // Without a total, the progress bar starts with default total of 100
      expect(mockProgressBar.start).toHaveBeenCalledWith(100, 0);

      // Simulate streaming with only loaded bytes (no total)
      // Wait enough time to bypass throttling
      jest.advanceTimersByTime(600);
      callback({ loaded: 5 * 1024 * 1024 }); // 5MB

      // Should convert to MB and update the progress value
      expect(mockProgressBar.update).toHaveBeenCalledWith(5);

      // Now simulate more data that exceeds the default total
      jest.advanceTimersByTime(600);
      callback({ loaded: 150 * 1024 * 1024 }); // 150MB

      // Should expand the total when loaded exceeds it
      expect(mockProgressBar.setTotal).toHaveBeenCalledWith(151);
      expect(mockProgressBar.update).toHaveBeenCalledWith(150);

      jest.useRealTimers();
    });

    it('should throttle progress updates', () => {
      jest.useFakeTimers();
      const callback = progressTracker.createProgressBar('Test', 100);
      
      // First call after initial time
      jest.advanceTimersByTime(600);
      callback({ loaded: 25, total: 100, percentage: 25 });
      expect(mockProgressBar.update).toHaveBeenCalledWith(25);
      
      // Second call immediately after should be throttled
      callback({ loaded: 50, total: 100, percentage: 50 });
      expect(mockProgressBar.update).toHaveBeenCalledTimes(1); // Still only once
      
      // Third call after sufficient time should work
      jest.advanceTimersByTime(600);
      callback({ loaded: 75, total: 100, percentage: 75 });
      expect(mockProgressBar.update).toHaveBeenCalledTimes(2);
      
      jest.useRealTimers();
    });

    it('should not throttle 100% completion', () => {
      jest.useFakeTimers();
      const callback = progressTracker.createProgressBar('Test', 100);
      
      // Even immediately after creation, 100% should not be throttled
      callback({ loaded: 100, total: 100, percentage: 100 });
      expect(mockProgressBar.update).toHaveBeenCalledWith(100);
      
      jest.useRealTimers();
    });

    it('should calculate and track progress rates', () => {
      jest.useFakeTimers();
      const callback = progressTracker.createProgressBar('Test', 1000);
      
      // Multiple updates to build rate history
      for (let i = 1; i <= 12; i++) {
        jest.advanceTimersByTime(1000);
        callback({ loaded: i * 100, total: 1000, percentage: i * 10 });
      }
      
      // Should have maintained rate history (max 10 entries)
      expect(mockProgressBar.update).toHaveBeenCalled();
      
      jest.useRealTimers();
    });

    it('should ignore updates when progress bar is not active', () => {
      const callback = progressTracker.createProgressBar('Test', 100);
      progressTracker.stop();
      
      callback({ loaded: 50, total: 100, percentage: 50 });
      
      // Update should not be called after stop
      expect(mockProgressBar.update).not.toHaveBeenCalled();
    });

    it('should ignore updates with no valid progress data', () => {
      jest.useFakeTimers();
      const callback = progressTracker.createProgressBar('Test', 100);
      
      jest.advanceTimersByTime(600);
      // Empty progress object
      callback({});
      
      expect(mockProgressBar.update).not.toHaveBeenCalled();
      
      jest.useRealTimers();
    });

    it('should handle changing total during progress', () => {
      jest.useFakeTimers();
      const callback = progressTracker.createProgressBar('Test', 100);
      
      jest.advanceTimersByTime(600);
      callback({ loaded: 50, total: 100, percentage: 50 });
      
      jest.advanceTimersByTime(600);
      // Total changes mid-progress
      callback({ loaded: 100, total: 200, percentage: 50 });
      
      expect(mockProgressBar.setTotal).toHaveBeenCalledWith(200);
      expect(mockProgressBar.update).toHaveBeenCalledWith(100);
      
      jest.useRealTimers();
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
      expect(mockStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('2 MB/10 MB'));
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

    it('should throttle stream updates based on size', () => {
      const callback = progressTracker.createStreamProgressBar('Upload');
      
      // Small update (< 1MB) should be throttled
      callback({ loaded: 500 * 1024, percentage: 5 });
      expect(mockStdoutWrite).not.toHaveBeenCalled();
      
      // Update exceeding threshold
      callback({ loaded: 1.5 * 1024 * 1024, percentage: 15 });
      expect(mockStdoutWrite).toHaveBeenCalled();
    });

    it('should handle unknown total in stream progress', () => {
      const callback = progressTracker.createStreamProgressBar('Upload');
      
      callback({ 
        loaded: 5 * 1024 * 1024, // 5MB
        percentage: 0 
      });

      expect(mockStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('5 MB/unknown'));
    });

    it('should format percentage correctly', () => {
      const callback = progressTracker.createStreamProgressBar('Upload');
      
      callback({ 
        loaded: 2.5 * 1024 * 1024,
        total: 10 * 1024 * 1024,
        percentage: 25.5 
      });

      expect(mockStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('(25.5%)'));
    });

    it('should always update on 100% completion regardless of threshold', () => {
      const callback = progressTracker.createStreamProgressBar('Upload');
      
      // Even small amount should trigger update at 100%
      callback({ loaded: 100, percentage: 100 });
      
      expect(mockStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('100.0%'));
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
      progressTracker.createProgressBar('Test', 100);
      progressTracker.log('Test message');

      expect(mockProgressBar.stop).toHaveBeenCalled();
      expect(mockProgressBar.start).toHaveBeenCalledWith(100, 0);
      expect(console.log).toHaveBeenCalledWith('ℹ Test message');
    });

    it('should preserve progress state when resuming after log', () => {
      jest.useFakeTimers();
      const callback = progressTracker.createProgressBar('Test', 100);
      
      // Update progress
      jest.advanceTimersByTime(600);
      callback({ loaded: 50, total: 100, percentage: 50 });
      
      // Log message
      progressTracker.log('Intermediate message', 'info');
      
      // Progress bar should resume with correct values
      expect(mockProgressBar.start).toHaveBeenCalledWith(100, 50);
      
      jest.useRealTimers();
    });
  });

  describe('formatBytes', () => {
    it('should format different byte sizes correctly', () => {
      const tracker = new ProgressTracker();
      
      // Access private method through streaming progress output
      const callback = tracker.createStreamProgressBar('Test');
      const mockWrite = jest.spyOn(process.stdout, 'write').mockImplementation();
      
      // Test 0 bytes
      callback({ loaded: 0, total: 0, percentage: 100 });
      expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('0 Bytes'));
      
      // Test bytes
      mockWrite.mockClear();
      callback({ loaded: 512, total: 1024, percentage: 100 });
      expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('512 Bytes'));
      
      // Test KB
      mockWrite.mockClear();
      callback({ loaded: 1536, total: 2048, percentage: 100 });
      expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('1.5 KB'));
      
      // Test MB
      mockWrite.mockClear();
      callback({ loaded: 5 * 1024 * 1024, total: 10 * 1024 * 1024, percentage: 100 });
      expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('5 MB'));
      
      // Test GB
      mockWrite.mockClear();
      callback({ loaded: 2 * 1024 * 1024 * 1024, total: 4 * 1024 * 1024 * 1024, percentage: 100 });
      expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('2 GB'));
      
      // Test TB
      mockWrite.mockClear();
      callback({ loaded: 1.5 * 1024 * 1024 * 1024 * 1024, percentage: 100 });
      expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('1.5 TB'));
      
      mockWrite.mockRestore();
    });
  });

  describe('formatValue in progress bar', () => {
    it('should format values for streaming (no total)', () => {
      const cliProgress = require('cli-progress');
      let formatValueFn: any;
      
      cliProgress.SingleBar.mockImplementation((options: any) => {
        formatValueFn = options.formatValue;
        return mockProgressBar;
      });
      
      const tracker = new ProgressTracker();
      tracker.createProgressBar('Test');
      
      // Test MB formatting when no total
      expect(formatValueFn(5)).toBe('5MB');
      expect(formatValueFn(0)).toBe('0');
      expect(formatValueFn(100)).toBe('100MB');
    });
  });

  describe('edge cases', () => {
    it('should handle multiple consecutive stops', () => {
      const tracker = new ProgressTracker();
      tracker.createProgressBar('Test');
      
      tracker.stop();
      tracker.stop(); // Second stop should not throw
      
      expect(mockProgressBar.stop).toHaveBeenCalledTimes(1);
    });

    it('should handle creating new progress bar after stop', () => {
      const tracker = new ProgressTracker();
      tracker.createProgressBar('Test1', 100);
      tracker.stop();

      const callback2 = tracker.createProgressBar('Test2', 200);

      expect(mockProgressBar.start).toHaveBeenCalledWith(200, 0);
      expect(typeof callback2).toBe('function');
    });

    it('should handle zero progress rate', () => {
      jest.useFakeTimers();
      const tracker = new ProgressTracker();
      const callback = tracker.createProgressBar('Test', 100);
      
      // Update with same value (no progress)
      jest.advanceTimersByTime(1000);
      callback({ loaded: 50, total: 100, percentage: 50 });
      
      jest.advanceTimersByTime(1000);
      callback({ loaded: 50, total: 100, percentage: 50 }); // Same value
      
      expect(mockProgressBar.update).toHaveBeenCalled();
      
      jest.useRealTimers();
    });
  });
});