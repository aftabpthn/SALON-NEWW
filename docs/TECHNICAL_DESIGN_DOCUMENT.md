# AuraShine Technical Design Requirements

## 1. Technical Design Document (TDD)

Act as a senior software architect.

Create a complete Technical Design Document (TDD) for `[APP NAME]`.

Include:

1. System overview
2. Architecture goals
3. Recommended technology stack
4. Frontend architecture
5. Backend architecture
6. Database architecture
7. Multi-tenant architecture
8. Authentication and authorization
9. Roles and permissions
10. API architecture
11. Module structure
12. Data flow
13. Request lifecycle
14. Third-party integrations
15. Payment integrations
16. Messaging integrations
17. File storage
18. Caching strategy
19. Background jobs and schedulers
20. Real-time communication
21. Search architecture
22. Security architecture
23. Audit logging
24. Error handling
25. Observability and monitoring
26. Performance strategy
27. Scalability strategy
28. Backup and disaster recovery
29. Deployment architecture
30. CI/CD workflow
31. Development, staging, and production environments
32. Testing strategy
33. Data migration strategy
34. Risks and technical trade-offs
35. Future architecture roadmap

Also include Mermaid diagrams for:

- High-level system architecture
- Data flow
- Authentication flow
- Deployment architecture
- Important module interactions

The design must be production-ready, secure, scalable, and understandable by developers and DevOps engineers.

## 2. Backend Database Schema

Act as a senior backend engineer and database architect.

Create a complete backend database schema for `[APP NAME]`.

Include:

1. All required database tables
2. Table descriptions
3. Fields and column names
4. Data types
5. Primary keys
6. Foreign keys
7. Unique constraints
8. Default values
9. Nullable and required fields
10. Table relationships
11. One-to-one relationships
12. One-to-many relationships
13. Many-to-many relationships
14. Junction tables
15. Indexes
16. Composite indexes
17. Audit fields
18. Soft-delete fields
19. Status fields
20. Tenant and branch isolation fields
21. Created and updated timestamps
22. Versioning and history tables
23. Activity logs
24. Notification tables
25. Integration tables
26. File and attachment tables
27. Reporting and analytics tables
28. Backup and archival considerations
29. Data validation rules
30. Data retention rules

For every table, provide:

- Table name
- Purpose
- Complete field list
- Field data type
- Required or optional status
- Default value
- Constraints
- Relationships
- Recommended indexes

Also provide:

- Entity Relationship Diagram using Mermaid
- Suggested migration order
- Sample SQL schema
- Example records
- Data integrity rules
- Scalability recommendations

Do not leave any important module without a proper schema.

## 3. App Flow Document

Act as a senior product designer and business analyst.

Create a complete App Flow Document for `[APP NAME]`.

Map every screen, user action, system response, and navigation path from onboarding to advanced feature usage.

Include:

1. App launch flow
2. Sign-up flow
3. Login flow
4. Forgot-password flow
5. OTP and verification flow
6. Organization setup
7. Branch setup
8. User onboarding
9. Role-based onboarding
10. Dashboard flow
11. Main navigation
12. Module-wise navigation
13. Create, view, edit, delete, restore, and archive flows
14. Search and filter flows
15. Approval workflows
16. Payment flows
17. Notification flows
18. Report and analytics flows
19. Settings flow
20. Profile and account flow
21. Permission-denied flow
22. Empty-state flow
23. Loading-state flow
24. Validation-error flow
25. Network-error flow
26. Session-expired flow
27. Logout flow
28. Mobile and responsive flow
29. Admin flow
30. Staff flow
31. Customer flow
32. Super-admin flow

For each screen, specify:

- Screen name
- Purpose
- User roles allowed
- Entry points
- UI sections
- Available actions
- Form fields
- Validation rules
- System responses
- Success state
- Error state
- Empty state
- Next screen
- Back-navigation behavior
- Permission requirements

Also provide Mermaid flowcharts for all major user journeys.

## 4. UI/UX Design Brief

Act as a senior UI/UX designer and design-system architect.

Create a complete UI/UX Design Brief for `[APP NAME]`.

Include:

1. Product design vision
2. Target users
3. Design goals
4. Overall visual mood
5. Brand personality
6. Color palette
7. Primary, secondary, accent, success, warning, error, and neutral colors
8. Light-mode palette
9. Dark-mode palette
10. Typography system
11. Font hierarchy
12. Spacing system
13. Grid and layout system
14. Border-radius system
15. Shadow system
16. Icon style
17. Button styles
18. Form-field styles
19. Card styles
20. Table styles
21. Modal and drawer styles
22. Sidebar and topbar design
23. Navigation behavior
24. Dashboard design
25. Chart and analytics styles
26. Empty states
27. Loading states
28. Skeleton loaders
29. Error states
30. Success states
31. Hover, focus, active, selected, and disabled states
32. Responsive behavior
33. Mobile design rules
34. Tablet design rules
35. Desktop design rules
36. Accessibility requirements
37. Component library
38. Design tokens
39. Animation and transition guidelines
40. Image and illustration style
41. UX writing and microcopy guidelines
42. Form usability rules
43. Data-heavy screen guidelines
44. Role-based UI behavior
45. Design consistency checklist

For every major component, explain:

- Visual style
- Size
- Padding
- Spacing
- Typography
- Color usage
- States
- Responsive behavior
- Accessibility requirements

Make the design premium, modern, clean, scalable, consistent, and suitable for a production SaaS application.
