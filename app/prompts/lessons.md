# Lessons Learned

Lessons are split by pipeline stage so each skill loads only what it needs — don't read them all up front:

| Stage | Lessons file | Read by |
|---|---|---|
| Find | `prompts/lessons/find.md` | `/find` |
| Gather | `prompts/lessons/gather.md` | `/gather` (includes the operator's accumulated Site Access Status for their country) |
| Build + QA | `prompts/lessons/build.md` | `/build`, the qa-reviewer agent, `/qa-fix` |
| Deploy | `prompts/lessons/deploy.md` | `/deploy` |
| Outreach | `prompts/lessons/outreach.md` | `/outreach`, `/follow-up`, `/warm-leads` |

When you learn something new, append it to the stage file where the *next run* needs it. A lesson that genuinely spans stages can be duplicated — each file must stand alone, because no stage reads the others.
