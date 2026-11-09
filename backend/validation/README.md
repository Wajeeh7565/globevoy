# Backend validation

The 40 existing backend validators are collected here. Run current groups from the
repository root using `npm run test:backend`, `npm run test:account`, and
`npm run test:providers`. The root runner and GitHub workflows use these paths.

Validators locate backend inputs relative to this directory; moving them did not
change Lambda handler names. Older standalone release checks remain available
for historical diagnosis and are not automatically part of the default suite.
