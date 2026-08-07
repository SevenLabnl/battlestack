# /write-plan

Invoke the **writing-plans** skill to break work into implementable tasks.

## Usage

```
/write-plan <feature description or path to design spec>
```

## What Happens

1. The writing-plans skill activates
2. Work is decomposed into atomic, ordered, verifiable tasks
3. Human checkpoints are inserted at critical decision points
4. A plan file is saved to the project

## Example

```
/write-plan docs/specs/2026-03-24-document-upload.md
```

Or without a spec:

```
/write-plan Add user profile editing with avatar upload
```
