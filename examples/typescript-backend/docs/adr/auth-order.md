# ADR: Validate auth at the request boundary

Authentication must run before route handlers.

Why:

- expired sessions should fail fast
- handlers should not branch on low-level token errors
- auth context should be attached once at the boundary
- downstream code should assume a valid authenticated shape

Trade-off:

- middleware becomes slightly denser
- route handlers become much simpler and easier to test
