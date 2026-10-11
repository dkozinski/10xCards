# Review follow-ups — account-and-data-deletion

Items accepted during implementation review that belong outside this slice.

## Link field errors to their inputs in `FormField` (from impl-review-phase-3, F4)

- **Why:** `FormField` renders the error text but sets no `aria-invalid` or `aria-describedby`. A screen reader hears the error only when a live region announces it, never when the user later returns to the field.
- **Where:** `src/components/auth/FormField.tsx`. It is used by `SignInForm`, `SignUpForm` and `DeleteAccount`.
- **What:** give the error `<p>` an id such as `${id}-error`. Set `aria-invalid={!!error}` and `aria-describedby` on the input when an error exists. Hints can get the same treatment.
- **Scope:** a separate a11y change, because it touches the S-01 auth forms. Behaviour for sighted users stays identical.
