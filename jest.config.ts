import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }]
  },
  testTimeout: 30000
};

export default config;
