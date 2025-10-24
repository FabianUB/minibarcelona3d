# Test Strategy

This feature set relies on a layered testing approach to ensure both correctness and user experience remain stable as we ship map functionality.

## Unit & Component Tests
- **Tooling**: [Vitest](https://vitest.dev/) with Testing Library (when rendering React components).
- **Purpose**: Validate data loaders, reducers, and React hooks in isolation with fast feedback.
- **Command**: `npm run test --prefix apps/web -- --run`

## End-to-End Journey Tests
- **Tooling**: [Playwright](https://playwright.dev/) with accessibility-specific chromium project (`chromium-axe`).
- **Purpose**: Exercise the map experience in real browsers—default viewport, recenter controls, legend flows, mobile layouts, and accessibility assertions.
- **Command (full matrix)**: `npm run test:e2e --prefix apps/web`
- **Command (single spec)**: `npm run test:e2e --prefix apps/web -- map-default-view.spec.ts`
- **Accessibility sweep**: `npm run test:accessibility --prefix apps/web`

## Static Analysis
- **Tooling**: [ESLint](https://eslint.org/).
- **Purpose**: Enforce the project’s TypeScript/React coding standards, detect common bugs before runtime.
- **Command**: `npm run lint --prefix apps/web`
