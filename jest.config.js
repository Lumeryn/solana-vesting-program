module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  verbose: true,
  forceExit: true,
  testTimeout: 200000,
  maxWorkers: 1,
  setupFilesAfterEnv: ["<rootDir>/jestSetup.ts"],
  globals: {
    "ts-jest": {
      tsconfig: "./tsconfig.json",
    },
  },
};
