---
patch
---

The generated wire types carry `CommandLog.callId`, the field the trace player reads to link to an action. The adapter does not send it; a trace's actions get their ids when the zip is written.
