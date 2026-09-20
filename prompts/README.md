# prompts/ — bring your own血肉

This directory is intentionally **empty of prompt content**.

The skeleton ships the *mechanism* (how prompts are assembled and passed to
the model); the *content* (system prompts, tool-usage policies, role
definitions) is yours to write. A skeleton that ships opinionated prompts is
no longer a skeleton.

## Suggested layout

```
prompts/
  working-agent.md      # system prompt for the main agent
  tools.md              # how tools are described to the model
```

## How prompts reach the model

1. `runIMLoop({ systemPrompt })` places your system prompt as the first
   `system` message.
2. `userTemplate` (optional) becomes the first `user` message.
3. Tool schemas come from the `ToolRegistry` you populate — tool
   `description` fields are part of your prompt surface too.

There is no prompt loader in the skeleton by design: read your files however
you like (fs, config, remote) and pass the strings in.
