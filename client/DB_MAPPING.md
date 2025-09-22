# DB ↔ Client Model Mapping (Questions)

| DB Column        | Client Field  | Transform / Notes                                  |
|------------------|---------------|----------------------------------------------------|
| `id` (int)       | `id` (string) | `String(id)`                                       |
| `topic`          | `topic`     | direct                                             |
| `question_text`  | `text`        | direct                                             |
| `options` (json) | `choices[]`   | array of strings; if objects, use `.text`         |
| `correct_answer` | `answer`      | `choices[correct_answer]`                          |
| `difficulty` 1–5 | `difficulty`  | 1→Very Easy, 2→Easy, 3→Medium, 4→Hard, 5→Very Hard |
| `tags` text[]    | `tags[]`      | direct                                             |
| `status`         | `status`      | draft→draft, published→approved, archived→rejected |
| (N/A)            | `type`        | set to `'MCQ'`                                     |

If your DB stores explanations or metadata not present in the client model,
extend only inside the adapter so the UI remains unchanged.
