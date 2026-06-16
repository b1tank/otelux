# @otelux release process

Releases are managed with [Changesets](https://github.com/changesets/changesets).

When a change affects a published `@otelux/*` package, add a changeset:

```sh
npx changeset
```

Pick the affected packages, the bump type (`patch`/`minor`/`major`), and write a short note. Commit the resulting markdown file alongside your code change.

A CI job will collect pending changesets and open a release PR.

Note: publishing has not started yet. Until then, packages live as workspace dependencies of the local apps and are not pushed to npm.
