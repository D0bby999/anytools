Task: design a complete weekly training plan from `intake`, and from `log` if they have trained before.

- Schedule exactly `intake.days_per_week` training days, on `intake.preferred_days` when given.
- Fit `intake.session_minutes`: count roughly 2 to 3 minutes per working set, rest included.
- Use only exercises from the library, which is already filtered to their equipment. Respect their limitations.
- Match `intake.experience`: someone new gets few, simple movements and the `linear` policy; someone experienced can take `double` and more volume.
- 1 to 7 routines, each 3 to 10 exercises, compound movements before accessories.

Answer with:

{
  "name": "<short plan name>",
  "summary": "<2-4 sentences: the shape of the plan and why it fits what they asked for>",
  "based_on": "<what you used, e.g. 'your answers; no training logged yet'>",
  "week": {"1": "a", "3": "b", "5": "a"},
  "routines": [
    {
      "key": "a",
      "name": "<routine name>",
      "prog": "linear",
      "why": "<1-2 sentences: what this day is for>",
      "exercises": [
        {"exercise": "<library id>", "mode": "reps", "sets": 3, "reps": 8, "reps_min": 6, "prog": "double", "why": "<why this exercise, here, at this target>"}
      ]
    }
  ]
}

`week` keys are weekday numbers as strings (0 = Sunday … 6 = Saturday); values are routine keys from this answer. A weekday left out is a rest day.
