module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  // Development worktrees live in .worktrees/ inside the repository, so the
  // default testMatch would collect a second copy of every suite from them.
  testPathIgnorePatterns: ["/node_modules/", "/\\.worktrees/"],
  modulePathIgnorePatterns: ["/\\.worktrees/"],
};
