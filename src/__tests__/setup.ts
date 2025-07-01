// Jest setup file
import 'jest';

// Mock AWS SDK dependencies that cause test failures
jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    done: jest.fn().mockResolvedValue({})
  }))
}));

// Set up global test environment
beforeEach(() => {
  // Reset environment variables before each test
  process.env.NODE_ENV = 'test';
  
  // Mock process.exit to prevent it from actually exiting the test process
  jest.spyOn(process, 'exit').mockImplementation(((code: number) => {
    console.log(`process.exit(${code}) was called`);
    return undefined as never;
  }) as any);
});

afterEach(() => {
  // Restore process.exit after each test
  jest.restoreAllMocks();
});

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in test:', reason);
});