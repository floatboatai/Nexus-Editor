# Nexus-Editor Coding Standards

## Overview

This document outlines the coding standards and quality practices for the Nexus-Editor project. Following these standards ensures consistency, maintainability, and high code quality across the codebase.

## Code Quality Tools

### ESLint

We use ESLint for static code analysis. The configuration enforces:

- TypeScript best practices
- Consistent import ordering
- No unused variables (except those prefixed with `_`)
- Limited `console` usage (only `warn`, `error`, `info` allowed)
- No explicit `any` types (use `unknown` or proper types)
- Consistent type imports

**Commands:**

```bash
# Check for linting issues
pnpm run lint

# Automatically fix linting issues
pnpm run lint:fix

# Run on specific file
pnpm run lint -- path/to/file.ts
```

### Prettier

We use Prettier for code formatting. Configuration enforces:

- 2-space indentation
- 100 character line width
- Semicolons required
- Double quotes for strings
- Consistent bracket spacing

**Commands:**

```bash
# Format all files
pnpm run format

# Check formatting without applying
pnpm run format:check
```

### TypeScript

We use strict TypeScript configuration with:

- `strict: true`
- No implicit any
- Strict null checks
- Strict function types

**Commands:**

```bash
# Type check all packages
pnpm run typecheck
```

### Combined Check

Run all quality checks at once:

```bash
pnpm run check  # runs typecheck + lint + format:check
```

## Git Hooks

We use Husky and lint-staged to enforce quality on commit:

### Pre-commit Hook

- Runs lint-staged to format and lint staged files
- Runs TypeScript type checking

### Commit Message Hook

- Enforces Conventional Commits format
- Requires: `type(scope): description`

## Code Style Guidelines

### TypeScript

- Use TypeScript strict mode
- Avoid `any` type - use `unknown` or proper interfaces
- Use type imports for types only: `import type { Interface } from 'module'`
- Use `readonly` for immutable properties
- Prefer `const` over `let` when variables are not reassigned

### Naming Conventions

- **Variables & Functions**: camelCase
- **Classes & Types**: PascalCase
- **Constants**: UPPER_SNAKE_CASE
- **Interfaces**: PascalCase (no `I` prefix)
- **Private Members**: camelCase (no underscore prefix)

### Imports Order

Imports should be ordered as follows:

1. Built-in Node.js modules
2. External dependencies
3. Internal modules
4. Parent directories
5. Sibling directories
6. Type imports

### Error Handling

- Use try-catch for async operations
- Log errors appropriately
- Avoid empty catch blocks
- Use error types for better debugging

### Testing

- Write unit tests for new features
- Use descriptive test names
- Test edge cases
- Mock external dependencies

## Commit Guidelines

### Conventional Commits

All commits must follow the Conventional Commits specification:

```
type(scope): description

[optional body]

[optional footer]
```

**Common Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Test changes
- `build`: Build system changes
- `ci`: CI configuration changes
- `chore`: Maintenance tasks

**Scope Examples:**

- `core`: Core editor engine
- `react`: React bindings
- `vue`: Vue bindings
- `plugin-*`: Specific plugin
- `electron-demo`: Demo application

### Commit Message Examples

```
feat(core): add multi-cursor support
fix(plugin-slash): prevent menu from closing on click
docs: update API documentation
style: run prettier formatting
refactor(core): simplify event emitter
test: add unit tests for live preview
build: update TypeScript to v5.9
ci: add GitHub Actions workflow
chore: update dependencies
```

## Best Practices

### 1. Keep Functions Small

- Aim for functions under 50 lines
- Single responsibility principle
- Clear input/output types

### 2. Avoid Magic Numbers/Strings

- Use constants or enums
- Document complex values

### 3. Document Complex Logic

- Use JSDoc for public APIs
- Add comments for non-obvious algorithms
- Document edge cases

### 4. Performance Considerations

- Avoid unnecessary re-renders
- Use debouncing for frequent updates
- Consider bundle size for new dependencies

### 5. Security

- Sanitize user input
- Avoid eval-like constructs
- Use Content Security Policy where applicable

## Development Workflow

1. **Before Starting**
   - Run `pnpm install` to install dependencies
   - Check for existing issues/PRs

2. **During Development**
   - Write tests for new features
   - Run `pnpm run check` frequently
   - Commit often with descriptive messages

3. **Before PR**
   - Run all checks: `pnpm run check`
   - Ensure tests pass: `pnpm test`
   - Verify build works: `pnpm build`
   - Update documentation as needed

4. **PR Submission**
   - Use descriptive PR title
   - Link to related issues
   - Describe changes and impact
   - Include before/after examples if applicable

## Common Issues & Solutions

### ESLint Errors

- **"no-unused-vars"**: Prefix unused variables with `_`
- **"no-explicit-any"**: Use proper types or `unknown`
- **"no-console"**: Use only `console.warn`, `console.error`, `console.info`

### TypeScript Errors

- **"strictNullChecks"**: Always handle null/undefined cases
- **"noImplicitAny"**: Provide explicit types for function parameters
- **"noUnusedParameters"**: Prefix unused parameters with `_`

### Build Issues

- Clear cache: `rm -rf node_modules/.cache`
- Reinstall: `pnpm install --force`
- Check TypeScript version compatibility

## Resources

- [ESLint Configuration](eslint.config.js)
- [Prettier Configuration](.prettierrc.json)
- [TypeScript Configuration](tsconfig.base.json)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

_Last Updated: 2026-06-30_
