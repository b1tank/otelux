# @otelux/adapter-direct

In-process `DataSource` implementation. Wraps an `@otelux/engine` instance so that `@otelux/ui` can talk to it directly inside the same process. Use it for tests and hosts that deliberately colocate the workbench and engine; the shared local runtime uses a transport adapter instead.
