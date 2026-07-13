# Angular App Structure

Use this folder layout for all frontend work:

- `core/` - app-wide config, guards, interceptors, singleton services, and models.
- `layout/` - app shell only: header, sidebar, topbar, navigation.
- `shared/` - reusable UI, directives, pipes, utilities.
- `pages/` - route entry pages grouped by domain.
- `features/` - domain business features grouped by domain.

Do not create a new top-level folder unless the domain is genuinely different.
