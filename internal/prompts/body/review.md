Task: read `log`, `aggregates` and `bodyweight` against `plan`, and decide whether the plan should change.

Change something only when the data says so:

- an exercise with `stalls` of 2 or more: swap it, or lower its sets or rep target;
- a planned weekday that is never trained, or sessions always done on another day: move it in `week`;
- sessions much longer than `intake.session_minutes`: cut volume;
- a muscle group with no sets in 30 days while others get plenty: add or rebalance.

Body weight moving against their goal is a note, not a plan change.

When nothing warrants a change, say so. Inventing a change to look useful is the fastest way to lose their trust:

{"nochange": true, "reading": "<a short honest paragraph on how the block went>", "notes": []}

Otherwise return the WHOLE revised plan with the changes listed. Keep routine `key`s of routines you keep. Propose few, high-conviction changes (at most six):

{
  "reading": "<2-4 sentences: what you saw>",
  "changes": [{"what": "<one change, plainly>", "why": "<the evidence: the stall count, the missed days, the empty muscle group>"}],
  "notes": ["<advice with no plan change attached>"],
  "name": "...", "summary": "...", "based_on": "<the dates and number of sessions you read>",
  "week": {"1": "a"},
  "routines": [{"key": "a", "name": "...", "prog": "...", "why": "...", "exercises": [{"exercise": "<library id>", "mode": "reps", "sets": 3, "reps": 8, "why": "..."}]}]
}
