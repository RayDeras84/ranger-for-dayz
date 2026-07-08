const browserGlobals = {
  AbortController: "readonly",
  Boolean: "readonly",
  Date: "readonly",
  Element: "readonly",
  Error: "readonly",
  JSON: "readonly",
  Map: "readonly",
  Math: "readonly",
  Number: "readonly",
  Promise: "readonly",
  Set: "readonly",
  String: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  document: "readonly",
  fetch: "readonly",
  setTimeout: "readonly",
  window: "readonly"
};

const nodeGlobals = {
  BigInt: "readonly",
  Buffer: "readonly",
  process: "readonly"
};

export default [
  {
    ignores: [
      "build/**",
      "dist/**",
      "node_modules/**",
      "release/**",
      ".tmp/**"
    ]
  },
  {
    files: ["src/**/*.{js,jsx}", "vite.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: browserGlobals
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "off"
    }
  },
  {
    files: ["electron/**/*.{js,mjs}", "scripts/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...browserGlobals,
        ...nodeGlobals
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  },
  {
    files: ["electron/preload.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        require: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  }
];
