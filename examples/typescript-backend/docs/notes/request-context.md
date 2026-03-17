# Request context note

The route layer depends on a stable `RequestContext`.

That context should be enriched by middleware, not rebuilt in every handler.

This keeps auth concerns close to the HTTP boundary and keeps route logic focused on domain behavior.
